use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Manager, State};

const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_CONTEXT_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_CONTEXT_DOCUMENTS: usize = 12;
const MAX_WORKSPACE_FILES: usize = 2_000;
const MAX_WORKSPACE_DEPTH: usize = 12;
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkdn"];
const CONTEXT_EXTENSIONS: &[&str] = &[
    "md",
    "markdown",
    "txt",
    "text",
    "rst",
    "adoc",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "less",
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "py",
    "rs",
    "go",
    "java",
    "kt",
    "kts",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "swift",
    "rb",
    "php",
    "sh",
    "zsh",
    "bash",
    "fish",
    "sql",
    "graphql",
    "gql",
    "proto",
    "vue",
    "svelte",
    "gradle",
    "properties",
    "ini",
    "conf",
    "log",
];
static SAVE_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDocument {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry {
    pub path: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspace {
    pub root: String,
    pub name: String,
    pub files: Vec<LocalFileEntry>,
    pub scan_limits: WorkspaceScanLimits,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScanLimits {
    pub file_count: Option<usize>,
    pub depth: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextDocument {
    pub path: String,
    pub name: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchTarget {
    File { document: LocalDocument },
    Folder { workspace: LocalWorkspace },
}

#[derive(Default)]
pub struct FileAccessState {
    files: Mutex<HashSet<PathBuf>>,
    roots: Mutex<HashSet<PathBuf>>,
    pending_launch: Mutex<Option<Result<LaunchTarget, String>>>,
    save_lock: Mutex<()>,
}

impl FileAccessState {
    pub fn with_pending(target: Result<Option<LaunchTarget>, String>) -> Self {
        let state = Self::default();
        match target {
            Ok(Some(target)) => state.set_launch_target(target),
            Err(reason) => state.set_launch_error(reason),
            Ok(None) => {}
        }
        state
    }

    fn authorize_file(&self, path: PathBuf) {
        self.files.lock().expect("file access lock").insert(path);
    }

    fn authorize_root(&self, path: PathBuf) {
        self.roots.lock().expect("root access lock").insert(path);
    }

    fn authorize_target(&self, target: &LaunchTarget) {
        match target {
            LaunchTarget::File { document } => {
                self.authorize_file(PathBuf::from(&document.path));
            }
            LaunchTarget::Folder { workspace } => {
                self.authorize_root(PathBuf::from(&workspace.root));
            }
        }
    }

    fn is_authorized(&self, path: &Path) -> bool {
        if self.files.lock().expect("file access lock").contains(path) {
            return true;
        }

        self.roots
            .lock()
            .expect("root access lock")
            .iter()
            .any(|root| path.starts_with(root))
    }

    pub fn set_launch_target(&self, target: LaunchTarget) {
        self.authorize_target(&target);
        *self.pending_launch.lock().expect("pending launch lock") = Some(Ok(target));
    }

    pub fn set_launch_error(&self, reason: String) {
        *self.pending_launch.lock().expect("pending launch lock") = Some(Err(reason));
    }

    fn take_launch_target(&self) -> Result<Option<LaunchTarget>, String> {
        self.pending_launch
            .lock()
            .expect("pending launch lock")
            .take()
            .transpose()
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn is_context_document(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            CONTEXT_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn canonical_existing(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|_| "无法访问该本地路径".to_string())
}

fn display_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn document_from_canonical(path: &Path) -> Result<LocalDocument, String> {
    if !path.is_file() || !is_markdown(path) {
        return Err("请选择 Markdown 文件".to_string());
    }

    let metadata = fs::metadata(path).map_err(|_| "无法读取文件信息".to_string())?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("Markdown 文件不能超过 16 MB".to_string());
    }

    let bytes = fs::read(path).map_err(|_| "无法读取该 Markdown 文件".to_string())?;
    let content =
        String::from_utf8(bytes).map_err(|_| "仅支持 UTF-8 编码的 Markdown 文件".to_string())?;
    Ok(LocalDocument {
        path: path.to_string_lossy().into_owned(),
        name: display_name(path, "未命名.md"),
        content,
    })
}

fn should_skip_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "target" | "dist" | "build" | "desktop-dist" | ".next"
        )
}

fn collect_markdown_files(root: &Path) -> (Vec<LocalFileEntry>, WorkspaceScanLimits) {
    fn visit(
        root: &Path,
        directory: &Path,
        depth: usize,
        files: &mut Vec<LocalFileEntry>,
        limits: &mut WorkspaceScanLimits,
    ) {
        if depth > MAX_WORKSPACE_DEPTH {
            limits.depth = Some(MAX_WORKSPACE_DEPTH);
            return;
        }
        if files.len() >= MAX_WORKSPACE_FILES {
            return;
        }

        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            if files.len() >= MAX_WORKSPACE_FILES {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !should_skip_directory(&path) {
                    visit(root, &path, depth + 1, files, limits);
                }
                continue;
            }
            if !file_type.is_file() || !is_markdown(&path) {
                continue;
            }

            let Ok(canonical) = fs::canonicalize(&path) else {
                continue;
            };
            if !canonical.starts_with(root) {
                continue;
            }
            let relative = canonical.strip_prefix(root).unwrap_or(&canonical);
            files.push(LocalFileEntry {
                path: canonical.to_string_lossy().into_owned(),
                name: display_name(&canonical, "未命名.md"),
                relative_path: relative.to_string_lossy().into_owned(),
            });
            if files.len() == MAX_WORKSPACE_FILES {
                // Reaching the bound does not prove there is another matching
                // file. Report the limit, rather than claiming a known omission.
                limits.file_count = Some(MAX_WORKSPACE_FILES);
            }
        }
    }

    let mut files = Vec::new();
    let mut limits = WorkspaceScanLimits::default();
    visit(root, root, 0, &mut files, &mut limits);
    files.sort_by_key(|entry| entry.relative_path.to_lowercase());
    (files, limits)
}

fn workspace_from_canonical(root: &Path) -> Result<LocalWorkspace, String> {
    if !root.is_dir() {
        return Err("请选择文件夹".to_string());
    }
    let (files, scan_limits) = collect_markdown_files(root);
    Ok(LocalWorkspace {
        root: root.to_string_lossy().into_owned(),
        name: display_name(root, "Markdown Workspace"),
        files,
        scan_limits,
    })
}

pub fn launch_target_from_path(path: &Path) -> Result<LaunchTarget, String> {
    let canonical = canonical_existing(path)?;
    if canonical.is_dir() {
        workspace_from_canonical(&canonical).map(|workspace| LaunchTarget::Folder { workspace })
    } else {
        document_from_canonical(&canonical).map(|document| LaunchTarget::File { document })
    }
}

pub fn launch_target_from_paths(
    paths: impl IntoIterator<Item = PathBuf>,
) -> Result<Option<LaunchTarget>, String> {
    let mut first_error = None;
    for path in paths {
        match launch_target_from_path(&path) {
            Ok(target) => return Ok(Some(target)),
            Err(reason) if first_error.is_none() => first_error = Some(reason),
            Err(_) => {}
        }
    }
    match first_error {
        Some(reason) => Err(reason),
        None => Ok(None),
    }
}

pub fn launch_target_from_args() -> Result<Option<LaunchTarget>, String> {
    launch_target_from_paths(
        std::env::args_os()
            .skip(1)
            .filter(|argument| !argument.to_string_lossy().starts_with('-'))
            .map(PathBuf::from),
    )
}

#[tauri::command]
pub async fn pick_markdown_file(
    state: State<'_, FileAccessState>,
) -> Result<Option<LocalDocument>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", MARKDOWN_EXTENSIONS)
        .pick_file()
        .await
    else {
        return Ok(None);
    };

    let canonical = canonical_existing(handle.path())?;
    let document = document_from_canonical(&canonical)?;
    state.authorize_file(canonical);
    Ok(Some(document))
}

#[tauri::command]
pub async fn pick_markdown_folder(
    state: State<'_, FileAccessState>,
) -> Result<Option<LocalWorkspace>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };

    let canonical = canonical_existing(handle.path())?;
    let workspace = workspace_from_canonical(&canonical)?;
    state.authorize_root(canonical);
    Ok(Some(workspace))
}

#[tauri::command]
pub async fn pick_ai_context_files(
    state: State<'_, FileAccessState>,
) -> Result<Vec<AiContextDocument>, String> {
    let Some(handles) = rfd::AsyncFileDialog::new()
        .add_filter("文本、资料与代码", CONTEXT_EXTENSIONS)
        .pick_files()
        .await
    else {
        return Ok(Vec::new());
    };

    if handles.len() > MAX_CONTEXT_DOCUMENTS {
        return Err(format!("一次最多选择 {MAX_CONTEXT_DOCUMENTS} 个上下文文件"));
    }

    let mut documents = Vec::with_capacity(handles.len());
    for handle in handles {
        let canonical = canonical_existing(handle.path())?;
        if !canonical.is_file() || !is_context_document(&canonical) {
            return Err("上下文仅支持常见文本、资料与代码文件".to_string());
        }
        let metadata =
            fs::metadata(&canonical).map_err(|_| "无法读取上下文文件信息".to_string())?;
        if metadata.len() > MAX_CONTEXT_DOCUMENT_BYTES {
            return Err(format!(
                "上下文文件 {} 不能超过 2 MB",
                display_name(&canonical, "未命名文件")
            ));
        }
        let bytes = fs::read(&canonical).map_err(|_| "无法读取上下文文件".to_string())?;
        let content =
            String::from_utf8(bytes).map_err(|_| "上下文文件必须使用 UTF-8 编码".to_string())?;
        state.authorize_file(canonical.clone());
        documents.push(AiContextDocument {
            path: canonical.to_string_lossy().into_owned(),
            name: display_name(&canonical, "未命名文件"),
            content,
        });
    }
    Ok(documents)
}

#[tauri::command]
pub fn read_local_markdown(
    path: String,
    state: State<'_, FileAccessState>,
) -> Result<LocalDocument, String> {
    let canonical = canonical_existing(Path::new(&path))?;
    if !state.is_authorized(&canonical) {
        return Err("该路径尚未通过系统选择器授权".to_string());
    }
    document_from_canonical(&canonical)
}

fn safe_suggested_name(suggested_name: &str) -> String {
    let basename = Path::new(suggested_name)
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("未命名.md");
    if is_markdown(Path::new(basename)) {
        basename.to_string()
    } else {
        format!("{basename}.md")
    }
}

#[derive(Serialize)]
pub struct LocalImage {
    bytes: Vec<u8>,
    mime: &'static str,
}

fn relative_image_path(document: &Path, source: &str) -> Result<PathBuf, String> {
    relative_attachment_path(document, source)
}

fn relative_attachment_path(document: &Path, source: &str) -> Result<PathBuf, String> {
    // Markdown URI normalization percent-encodes Windows separators. Normalize
    // only those separators before URL resolution; decoding the whole source
    // here would decode literal percent escapes a second time in to_file_path.
    let source = source
        .replace('\\', "/")
        .replace("%5C", "/")
        .replace("%5c", "/");
    if source.is_empty()
        || source.trim() != source
        || source.chars().any(char::is_control)
        || source.starts_with('/')
        || source
            .get(..3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("%2f"))
        || source.starts_with('#')
        || url::Url::parse(&source).is_ok()
    {
        return Err("仅支持文档相对路径".into());
    }
    let base = url::Url::from_file_path(document).map_err(|_| "文档路径无效")?;
    let resolved = base.join(&source).map_err(|_| "文件路径无效")?;
    resolved.to_file_path().map_err(|_| "文件路径无效".into())
}

fn authorized_document(path: &Path, state: &FileAccessState) -> Result<PathBuf, String> {
    let document = canonical_existing(path)?;
    if !state.is_authorized(&document) || !document.is_file() || !is_markdown(&document) {
        return Err("该路径尚未通过系统选择器授权".into());
    }
    Ok(document)
}

fn resolve_local_attachment(
    document: &Path,
    source: &str,
    state: &FileAccessState,
) -> Result<PathBuf, String> {
    let document = authorized_document(document, state)?;
    let target = dunce::canonicalize(relative_attachment_path(&document, source)?)
        .map_err(|_| "本地文件不存在或无法访问")?;
    if !target.is_file() {
        return Err("链接目标必须是文件".into());
    }
    let extension = target
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    // A document link may open a document with its registered app, not execute
    // a program, script, shortcut, or desktop launcher supplied by Markdown.
    const DOCUMENT_TYPES: &[&str] = &[
        "xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "ods", "numbers", "doc", "docx", "odt", "rtf",
        "pages", "ppt", "pptx", "odp", "key", "pdf", "txt", "md", "markdown", "mdown", "mkdn",
        "log", "json", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tif", "tiff",
        "mp3", "wav", "m4a", "ogg", "flac", "mp4", "mov", "webm", "mkv", "zip",
    ];
    if !DOCUMENT_TYPES.contains(&extension.as_str()) {
        return Err("不支持打开此文件类型；请链接表格、文档、图片或媒体文件".into());
    }
    Ok(target)
}

#[tauri::command]
pub async fn open_relative_file(
    document_path: String,
    source: String,
    state: State<'_, FileAccessState>,
) -> Result<(), String> {
    let target = resolve_local_attachment(Path::new(&document_path), &source, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::links::open_with_default(target.as_os_str())
    })
    .await
    .map_err(|_| "无法打开链接".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    relative_path: String,
    name: String,
}

fn pasted_image_extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok("webp")
    } else if bytes.starts_with(b"BM") {
        Ok("bmp")
    } else if bytes.get(4..8) == Some(b"ftyp")
        && matches!(bytes.get(8..12), Some(b"avif" | b"avis"))
    {
        Ok("avif")
    } else {
        Err("请粘贴 PNG、JPEG、GIF、WebP、BMP 或 AVIF 图片".into())
    }
}

fn store_pasted_image(
    document: &Path,
    name: &str,
    data: &str,
    state: &FileAccessState,
) -> Result<SavedImage, String> {
    let document = authorized_document(document, state)?;
    const LIMIT: usize = 20 * 1024 * 1024;
    if data.len() > LIMIT.div_ceil(3) * 4 {
        return Err("图片必须是小于 20 MB 的文件".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "图片数据无效")?;
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err("图片必须是小于 20 MB 的文件".into());
    }
    let extension = pasted_image_extension(&bytes)?;
    let directory = document.parent().ok_or("文档路径无效")?.join("images");
    match fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("无法创建 images 文件夹，请检查写入权限".into()),
    }
    let metadata = fs::symlink_metadata(&directory).map_err(|_| "无法访问 images 文件夹")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("images 必须是文档目录内的普通文件夹".into());
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("image");
    let stem: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
        .take(60)
        .collect();
    let stem = if stem.is_empty() { "image" } else { &stem };
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    for _ in 0..64 {
        let nonce = SAVE_NONCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("{stem}-{timestamp}-{nonce}.{extension}");
        let path = directory.join(&name);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("无法写入 images 文件夹，请检查写入权限".into()),
        };
        if file
            .write_all(&bytes)
            .and_then(|_| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err("图片保存失败，请重试".into());
        }
        return Ok(SavedImage {
            relative_path: format!("images/{name}"),
            name,
        });
    }
    Err("无法生成唯一的图片文件名，请重试".into())
}

#[tauri::command]
pub async fn save_pasted_image(
    app: tauri::AppHandle,
    document_path: String,
    name: String,
    data: String,
) -> Result<SavedImage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FileAccessState>();
        store_pasted_image(Path::new(&document_path), &name, &data, &state)
    })
    .await
    .map_err(|_| "图片保存失败，请重试".to_string())?
}

fn load_local_image(
    document_path: &Path,
    source: &str,
    state: &FileAccessState,
) -> Result<LocalImage, String> {
    let document = canonical_existing(document_path)?;
    if !state.is_authorized(&document) || !is_markdown(&document) {
        return Err("该路径尚未通过系统选择器授权".into());
    }
    let path = canonical_existing(&relative_image_path(&document, source)?)?;
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return Err("不支持的图片格式".into()),
    };
    // Bound both the allocation and read, even if the file grows after metadata.
    let file = File::open(&path).map_err(|_| "无法读取图片")?;
    let metadata = file.metadata().map_err(|_| "无法读取图片")?;
    const LIMIT: u64 = 20 * 1024 * 1024;
    if !metadata.is_file() || metadata.len() > LIMIT {
        return Err("图片必须是小于 20 MB 的文件".into());
    }
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(file, LIMIT + 1), &mut bytes)
        .map_err(|_| "无法读取图片")?;
    if bytes.len() as u64 > LIMIT {
        return Err("图片必须是小于 20 MB 的文件".into());
    }
    Ok(LocalImage { bytes, mime })
}

#[tauri::command]
pub fn read_local_image(
    document_path: String,
    source: String,
    state: State<'_, FileAccessState>,
) -> Result<LocalImage, String> {
    load_local_image(Path::new(&document_path), &source, &state)
}

fn create_temporary_sibling(destination: &Path) -> io::Result<(PathBuf, File)> {
    let directory = destination
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing parent directory"))?;
    let basename = destination
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("document.md");

    for _ in 0..64 {
        let nonce = SAVE_NONCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            ".{basename}.prosemap-{}-{nonce}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "unable to reserve temporary file",
    ))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn rename_with_flags(source: &Path, target: &Path, exchange: bool) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid source path"))?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid target path"))?;
    #[cfg(target_os = "macos")]
    let result = {
        extern "C" {
            fn renamex_np(
                from: *const std::ffi::c_char,
                to: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        // RENAME_SWAP / RENAME_EXCL, respectively.
        unsafe {
            renamex_np(
                source.as_ptr(),
                target.as_ptr(),
                if exchange { 2 } else { 4 },
            )
        }
    };
    #[cfg(target_os = "linux")]
    let result = {
        extern "C" {
            fn renameat2(
                from_fd: i32,
                from: *const std::ffi::c_char,
                to_fd: i32,
                to: *const std::ffi::c_char,
                flags: u32,
            ) -> i32;
        }
        // AT_FDCWD; RENAME_EXCHANGE / RENAME_NOREPLACE, respectively.
        unsafe {
            renameat2(
                -100,
                source.as_ptr(),
                -100,
                target.as_ptr(),
                if exchange { 2 } else { 1 },
            )
        }
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn publish_new_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    rename_with_flags(temporary, destination, false)
}

#[cfg(target_os = "windows")]
fn publish_new_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn publish_new_file(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "safe creation is unavailable",
    ))
}

// Preserve the exact directory entry displaced by the commit. A second
// pre-rename read cannot close the race with a noncooperating external writer.
struct ReplacementError {
    source: io::Error,
    recovery: Option<PathBuf>,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn replace_preserving_destination(
    temporary: &Path,
    destination: &Path,
) -> Result<PathBuf, ReplacementError> {
    rename_with_flags(temporary, destination, true)
        .map(|()| temporary.to_path_buf())
        .map_err(|source| ReplacementError {
            source,
            recovery: None,
        })
}

#[cfg(target_os = "windows")]
fn replace_preserving_destination(
    temporary: &Path,
    destination: &Path,
) -> Result<PathBuf, ReplacementError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let (backup, reservation) =
        create_temporary_sibling(destination).map_err(|source| ReplacementError {
            source,
            recovery: None,
        })?;
    drop(reservation);
    fs::remove_file(&backup).map_err(|source| ReplacementError {
        source,
        recovery: None,
    })?;
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let source = wide(temporary);
    let target = wide(destination);
    let saved = wide(&backup);
    let result = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            source.as_ptr(),
            saved.as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if result != 0 {
        Ok(backup)
    } else {
        let source = io::Error::last_os_error();
        // Windows can move the old file to the backup name before reporting
        // ERROR_UNABLE_TO_MOVE_REPLACEMENT_2. Never delete that backup.
        let recovery = backup.symlink_metadata().ok().map(|_| backup);
        Err(ReplacementError { source, recovery })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn replace_preserving_destination(_: &Path, _: &Path) -> Result<PathBuf, ReplacementError> {
    Err(ReplacementError {
        source: io::Error::new(
            io::ErrorKind::Unsupported,
            "safe replacement is unavailable",
        ),
        recovery: None,
    })
}

fn recovery_notice(destination: &Path, displaced: &Path) -> String {
    // Give a conflicting Markdown version a visible, openable name. A failed
    // rename leaves the original recovery entry intact; it is never discarded.
    let mut recovery = displaced.to_path_buf();
    for _ in 0..64 {
        let nonce = SAVE_NONCE.fetch_add(1, Ordering::Relaxed);
        let visible = destination.with_file_name(format!(
            "ProseMap-recovery-{}-{nonce}.md",
            std::process::id()
        ));
        match publish_new_file(displaced, &visible) {
            Ok(()) => {
                recovery = visible;
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => break,
        }
    }
    #[cfg(unix)]
    if let Some(directory) = destination.parent() {
        let _ = File::open(directory).and_then(|handle| handle.sync_all());
    }
    format!("保存期间文件状态发生变化。替换前的版本已保留到：{}。当前编辑仍保留，请检查恢复副本后重新载入或另存为。", recovery.display())
}

const EXTERNAL_CHANGE: &str =
    "文件已被外部修改，未覆盖磁盘内容。请重新载入，或另存为以保留当前修改。";

fn save_as_baseline(destination: &Path) -> Result<Option<Vec<u8>>, String> {
    let file = match File::open(destination) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取另存为目标，请选择其他文件名".into()),
    };
    if !file
        .metadata()
        .map_err(|_| "无法读取另存为目标，请选择其他文件名")?
        .is_file()
    {
        return Err("无法读取另存为目标，请选择其他文件名".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取另存为目标，请选择其他文件名")?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("另存为目标超过 16 MB，请选择其他文件名".into());
    }
    Ok(Some(bytes))
}

fn verify_document_unchanged(destination: &Path, expected: Option<&[u8]>) -> io::Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    // A bounded read also handles an external writer replacing a small file
    // with a large one. Compare bytes, not timestamps (which can be preserved).
    let mut current = Vec::new();
    File::open(destination)?
        .take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut current)?;
    if current != expected {
        return Err(io::Error::new(io::ErrorKind::WouldBlock, EXTERNAL_CHANGE));
    }
    Ok(())
}

fn write_document_atomically(
    destination: &Path,
    content: &[u8],
    expected: Option<&[u8]>,
) -> Result<(), String> {
    write_document_before_commit(destination, content, expected, |_| {})
}

fn write_document_before_commit(
    destination: &Path,
    content: &[u8],
    expected: Option<&[u8]>,
    before_commit: impl FnOnce(&Path),
) -> Result<(), String> {
    let (temporary, mut file) = create_temporary_sibling(destination)
        .map_err(|_| "无法在目标文件夹创建安全的临时文件".to_string())?;
    let mut recovery = None;
    let result = (|| -> io::Result<()> {
        file.write_all(content)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(destination) {
            fs::set_permissions(&temporary, metadata.permissions())?;
        }
        drop(file);
        // Check after writing/flushing the temporary file, immediately before
        // replacement. Other applications do not share our in-process lock.
        verify_document_unchanged(destination, expected)?;
        before_commit(destination);
        if expected.is_some() {
            match replace_preserving_destination(&temporary, destination) {
                Ok(displaced) => recovery = Some(displaced),
                Err(error) => {
                    recovery = error.recovery;
                    return Err(error.source);
                }
            }
            // Inspect the version actually displaced, not a racy pre-commit
            // snapshot. Keep it on mismatch or read failure; do not roll back
            // over a newer external version that may already occupy the path.
            verify_document_unchanged(recovery.as_ref().unwrap(), expected)?;
            let _ = fs::remove_file(recovery.take().unwrap());
        } else {
            publish_new_file(&temporary, destination)?;
        }
        #[cfg(unix)]
        if let Some(directory) = destination.parent() {
            let _ = File::open(directory).and_then(|handle| handle.sync_all());
        }
        Ok(())
    })();

    if result.is_err() && recovery.as_deref() != Some(temporary.as_path()) {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| {
        if let Some(displaced) = recovery {
            return recovery_notice(destination, &displaced);
        }
        if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::AlreadyExists
        ) {
            EXTERNAL_CHANGE.to_string()
        } else if error.kind() == io::ErrorKind::Unsupported {
            "当前文件系统不支持此安全保存方式，请另存到其他位置。".to_string()
        } else {
            "无法安全保存该 Markdown 文件。当前编辑已保留，请检查磁盘文件后重试或另存为。"
                .to_string()
        }
    })
}

#[tauri::command]
pub async fn save_local_markdown(
    path: Option<String>,
    suggested_name: String,
    content: String,
    expected_content: Option<String>,
    state: State<'_, FileAccessState>,
) -> Result<Option<LocalDocument>, String> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Markdown 文件不能超过 16 MB".to_string());
    }

    let existing_document = path.is_some();
    if existing_document && expected_content.is_none() {
        return Err("无法确认文件原始内容，请重新打开后保存".to_string());
    }
    let destination = if let Some(path) = path {
        let canonical = canonical_existing(Path::new(&path))?;
        if !state.is_authorized(&canonical) {
            return Err("该路径尚未通过系统选择器授权".to_string());
        }
        if !canonical.is_file() || !is_markdown(&canonical) {
            return Err("只能保存 Markdown 文件".to_string());
        }
        canonical
    } else {
        let Some(handle) = rfd::AsyncFileDialog::new()
            .add_filter("Markdown", MARKDOWN_EXTENSIONS)
            .set_file_name(safe_suggested_name(&suggested_name))
            .save_file()
            .await
        else {
            return Ok(None);
        };
        let mut selected = handle.path().to_path_buf();
        if !is_markdown(&selected) {
            selected.set_extension("md");
        }
        selected
    };

    let _save_guard = state
        .save_lock
        .lock()
        .map_err(|_| "文件保存失败，请重试".to_string())?;
    // Save As also needs a baseline for a replacement approved in the native
    // picker. A new target must be published without replacing a file that
    // another application creates while our temporary file is being written.
    let expected = if existing_document {
        expected_content.map(String::into_bytes)
    } else {
        save_as_baseline(&destination)?
    };
    write_document_atomically(&destination, content.as_bytes(), expected.as_deref())?;
    let canonical = canonical_existing(&destination)?;
    state.authorize_file(canonical.clone());
    // The saved baseline must be our committed snapshot, even if another
    // application changes the path immediately after the commit.
    Ok(Some(LocalDocument {
        name: display_name(&canonical, "未命名文件"),
        path: canonical.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
pub async fn export_shared_markdown(name: String, content: String) -> Result<bool, String> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Markdown 文件不能超过 16 MB".into());
    }
    let Some(handle) = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md"])
        .set_file_name(safe_suggested_name(&name))
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let destination = handle.path().with_extension("md");
    if destination.exists() {
        return Err("请选择新的文件名，导出不能覆盖已有文件。".into());
    }
    // The no-baseline commit also refuses a destination created after the picker.
    write_document_atomically(&destination, content.as_bytes(), None)?;
    Ok(true)
}

#[tauri::command]
pub fn read_launch_target(
    state: State<'_, FileAccessState>,
) -> Result<Option<LaunchTarget>, String> {
    state.take_launch_target()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "prosemap-synthetic-workspace-{}-{}",
            std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        fs::canonicalize(root).unwrap()
    }

    #[test]
    fn workspace_reports_the_file_limit_without_claiming_known_omissions() {
        let root = workspace_fixture();
        for index in 0..MAX_WORKSPACE_FILES - 1 {
            fs::write(root.join(format!("synthetic-{index:04}.md")), "# Synthetic").unwrap();
        }
        let below = workspace_from_canonical(&root).unwrap();
        assert_eq!(below.files.len(), MAX_WORKSPACE_FILES - 1);
        assert_eq!(below.scan_limits.file_count, None);
        for index in MAX_WORKSPACE_FILES - 1..=MAX_WORKSPACE_FILES {
            fs::write(root.join(format!("synthetic-{index:04}.md")), "# Synthetic").unwrap();
            let workspace = workspace_from_canonical(&root).unwrap();
            assert_eq!(workspace.files.len(), MAX_WORKSPACE_FILES);
            assert_eq!(workspace.scan_limits.file_count, Some(MAX_WORKSPACE_FILES));
            assert_eq!(workspace.scan_limits.depth, None);
            let wire = serde_json::to_value(&workspace).unwrap();
            assert_eq!(wire["scanLimits"]["fileCount"], MAX_WORKSPACE_FILES);
            assert!(wire["scanLimits"]["depth"].is_null());
            assert!(workspace
                .files
                .windows(2)
                .all(|pair| pair[0].relative_path <= pair[1].relative_path));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_depth_warning_preserves_hidden_build_and_symlink_filters() {
        let root = workspace_fixture();
        for directory in [
            ".hidden",
            "node_modules",
            "target",
            "dist",
            "build",
            "desktop-dist",
            ".next",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
            fs::write(root.join(directory).join("hidden.md"), "# Synthetic hidden").unwrap();
        }
        fs::write(root.join("root.MD"), "# Synthetic root").unwrap();
        fs::write(root.join("unsupported.txt"), "Synthetic plain text").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("root.MD"), root.join("linked.md")).unwrap();
            std::os::unix::fs::symlink(root.join(".hidden"), root.join("linked-folder")).unwrap();
        }
        let mut nested = root.clone();
        for _ in 0..MAX_WORKSPACE_DEPTH {
            nested = nested.join("level");
        }
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("depth-12.markdown"), "# Synthetic depth 12").unwrap();
        let boundary = workspace_from_canonical(&root).unwrap();
        assert_eq!(boundary.files.len(), 2);
        assert_eq!(boundary.scan_limits.depth, None);
        fs::create_dir_all(nested.join("level")).unwrap();
        fs::write(nested.join("level/depth-13.md"), "# Synthetic depth 13").unwrap();
        let limited = workspace_from_canonical(&root).unwrap();
        assert_eq!(limited.files.len(), 2);
        assert_eq!(limited.scan_limits.depth, Some(MAX_WORKSPACE_DEPTH));
        assert_eq!(limited.scan_limits.file_count, None);
        fs::remove_file(root.join("root.MD")).unwrap();
        fs::remove_file(nested.join("depth-12.markdown")).unwrap();
        let empty = workspace_from_canonical(&root).unwrap();
        assert!(empty.files.is_empty());
        assert_eq!(empty.scan_limits.depth, Some(MAX_WORKSPACE_DEPTH));
        fs::remove_dir_all(root).unwrap();
    }

    fn attachment_fixture() -> (PathBuf, PathBuf, FileAccessState) {
        let root = std::env::temp_dir().join(format!(
            "prosemap-attachments-{}-{}",
            std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("notes")).unwrap();
        let document = root.join("notes/draft.md");
        fs::write(&document, "# attachments").unwrap();
        let state = FileAccessState::default();
        state.authorize_file(fs::canonicalize(&document).unwrap());
        (root, document, state)
    }

    #[test]
    fn relative_files_resolve_only_from_authorized_documents() {
        let (root, document, state) = attachment_fixture();
        fs::write(root.join("年 报.xlsx"), b"spreadsheet").unwrap();
        let path = resolve_local_attachment(&document, "../年%20报.xlsx", &state).unwrap();
        assert_eq!(path, dunce::canonicalize(root.join("年 报.xlsx")).unwrap());
        assert_eq!(
            resolve_local_attachment(&document, "..%5C%E5%B9%B4%20%E6%8A%A5.xlsx", &state).unwrap(),
            path
        );
        #[cfg(windows)]
        assert!(!path.to_string_lossy().starts_with(r"\\?\"));
        assert!(resolve_local_attachment(
            &document,
            "../年%20报.xlsx",
            &FileAccessState::default()
        )
        .is_err());
        assert!(resolve_local_attachment(&document, "missing.xlsx", &state).is_err());
        assert!(resolve_local_attachment(&document, "../", &state).is_err());
        fs::write(root.join("run.desktop"), "Exec=sh").unwrap();
        assert!(resolve_local_attachment(&document, "../run.desktop", &state).is_err());
        for source in [
            "file:///tmp/test.xlsx",
            "//server/a.xlsx",
            "C:\\a.xlsx",
            "\nfile.xlsx",
        ] {
            assert!(relative_attachment_path(&document, source).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pasted_images_create_or_reuse_images_without_overwriting() {
        let (root, document, state) = attachment_fixture();
        let bytes = include_bytes!("../../tests/fixtures/assets/中文 图标.png");
        let data = STANDARD.encode(bytes);
        assert!(
            store_pasted_image(&document, "image.png", &data, &FileAccessState::default()).is_err()
        );
        assert!(!root.join("notes/images").exists());
        assert!(store_pasted_image(
            &document,
            "image.png",
            &STANDARD.encode(b"not an image"),
            &state
        )
        .is_err());
        assert!(!root.join("notes/images").exists());
        let a = store_pasted_image(&document, "../../截图.png", &data, &state).unwrap();
        let b = store_pasted_image(&document, "../../截图.png", &data, &state).unwrap();
        assert_ne!(a.relative_path, b.relative_path);
        assert!(a.relative_path.starts_with("images/截图-"));
        assert_eq!(
            load_local_image(&document, &a.relative_path, &state)
                .unwrap()
                .bytes,
            bytes
        );
        assert_eq!(
            fs::read(root.join("notes").join(&b.relative_path)).unwrap(),
            bytes
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pasted_images_preserve_a_file_named_images() {
        let (root, document, state) = attachment_fixture();
        fs::write(root.join("notes/images"), b"keep me").unwrap();
        assert!(store_pasted_image(
            &document,
            "image.png",
            &STANDARD.encode(include_bytes!("../../tests/fixtures/assets/中文 图标.png")),
            &state
        )
        .is_err());
        assert_eq!(fs::read(root.join("notes/images")).unwrap(), b"keep me");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn pasted_images_do_not_follow_an_images_symlink() {
        let (root, document, state) = attachment_fixture();
        fs::create_dir(root.join("elsewhere")).unwrap();
        std::os::unix::fs::symlink(root.join("elsewhere"), root.join("notes/images")).unwrap();
        assert!(store_pasted_image(
            &document,
            "image.png",
            &STANDARD.encode(include_bytes!("../../tests/fixtures/assets/中文 图标.png")),
            &state
        )
        .is_err());
        assert_eq!(fs::read_dir(root.join("elsewhere")).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_paths_resolve_against_document_with_url_decoding() {
        let root = std::env::temp_dir();
        let document = root.join("notes").join("draft.md");
        assert_eq!(
            relative_image_path(&document, "../images/图%20片.png?v=1#x").unwrap(),
            root.join("images").join("图 片.png")
        );
        assert_eq!(
            relative_image_path(&document, "assets\\image.png").unwrap(),
            root.join("notes").join("assets").join("image.png")
        );
        for source in [
            "",
            "/etc/image.png",
            "https://example.com/image.png",
            "file:///tmp/image.png",
            "//server/image.png",
            "#icon",
        ] {
            assert!(relative_image_path(&document, source).is_err());
        }
    }

    #[test]
    fn attachment_paths_normalize_markdown_encoded_separators_without_double_decoding() {
        let root = std::env::temp_dir();
        let document = root.join("notes/draft.md");
        for source in [
            r".\附件\年 报 report.xlsx",
            ".%5C%E9%99%84%E4%BB%B6%5C%E5%B9%B4%20%E6%8A%A5%20report.xlsx",
            ".%5c%E9%99%84%E4%BB%B6%5c%E5%B9%B4%20%E6%8A%A5%20report.xlsx",
        ] {
            assert_eq!(
                relative_attachment_path(&document, source).unwrap(),
                root.join("notes/附件/年 报 report.xlsx"),
                "{source}"
            );
        }
        assert_eq!(
            relative_attachment_path(&document, "..%5Cassets%5cQ1%20plan.xlsx").unwrap(),
            root.join("assets/Q1 plan.xlsx")
        );
        assert_eq!(
            relative_attachment_path(&document, "literal%255Cname%2520.xlsx").unwrap(),
            root.join("notes/literal%5Cname%20.xlsx")
        );
        for source in [
            "%5Ctmp%5Creport.xlsx",
            "%5c%5cserver%5cshare%5creport.xlsx",
            "%2Ftmp/report.xlsx",
            "%2ftmp/report.xlsx",
            "C:%5Ctmp%5Creport.xlsx",
        ] {
            assert!(
                relative_attachment_path(&document, source).is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn images_require_an_authorized_document_and_supported_file() {
        let root = std::env::temp_dir().join(format!(
            "prosemap-images-{}-{}",
            std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("notes")).unwrap();
        let document = root.join("notes/draft.md");
        fs::write(&document, "![image](../图%20片.png)").unwrap();
        fs::write(root.join("图 片.png"), b"image bytes").unwrap();
        fs::write(root.join("secret.txt"), "private text").unwrap();
        let state = FileAccessState::default();
        assert!(load_local_image(&document, "../图%20片.png", &state).is_err());
        state.authorize_file(fs::canonicalize(&document).unwrap());
        let image = load_local_image(&document, "../图%20片.png", &state).unwrap();
        assert_eq!(image.mime, "image/png");
        assert_eq!(image.bytes, b"image bytes");
        assert!(load_local_image(&document, "../secret.txt", &state).is_err());
        assert!(load_local_image(&document, "missing.png", &state).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_supported_markdown_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("notes.MD")));
        assert!(is_markdown(Path::new("notes.markdown")));
        assert!(!is_markdown(Path::new("notes.txt")));
    }

    #[test]
    fn recognizes_text_and_code_context_without_accepting_binary_files() {
        assert!(is_context_document(Path::new("architecture.MD")));
        assert!(is_context_document(Path::new("service.ts")));
        assert!(is_context_document(Path::new("settings.yaml")));
        assert!(!is_context_document(Path::new("secret.key")));
        assert!(!is_context_document(Path::new("screenshot.png")));
    }

    #[test]
    fn suggested_name_cannot_escape_the_picker_directory() {
        assert_eq!(safe_suggested_name("../../draft"), "draft.md");
        assert_eq!(safe_suggested_name("map.MD"), "map.MD");
    }

    #[test]
    fn atomic_save_replaces_a_document_without_partial_content() {
        let directory = std::env::temp_dir().join(format!(
            "prosemap-atomic-save-{}-{}",
            std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).expect("create test directory");
        let destination = directory.join("draft.md");
        fs::write(&destination, "old").expect("write original");

        write_document_atomically(&destination, "完整的新内容".as_bytes(), Some(b"old"))
            .expect("atomic save");
        assert_eq!(
            fs::read_to_string(&destination).expect("read replacement"),
            "完整的新内容"
        );

        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn external_changes_block_save_without_losing_either_version_or_leaking_temp_files() {
        let directory = std::env::temp_dir().join(format!(
            "prosemap-conflict-{}-{}",
            std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let destination = directory.join("中文.md");
        let original = "# 原文\r\n🧭\r\n".as_bytes();
        fs::write(&destination, original).unwrap();
        write_document_atomically(&destination, b"local edit", Some(original)).unwrap();
        fs::write(&destination, b"external edit").unwrap();
        assert_eq!(
            write_document_atomically(&destination, b"second local edit", Some(b"local edit")),
            Err(EXTERNAL_CHANGE.into())
        );
        assert_eq!(fs::read(&destination).unwrap(), b"external edit");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        // Reloading establishes a new baseline; saving can safely continue.
        write_document_atomically(&destination, b"merged edit", Some(b"external edit")).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"merged edit");
        fs::remove_file(&destination).unwrap();
        assert!(write_document_atomically(
            &destination,
            b"must not resurrect",
            Some(b"merged edit")
        )
        .is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn launch_target_serializes_to_the_frontend_contract() {
        let target = LaunchTarget::File {
            document: LocalDocument {
                path: "/tmp/test.md".into(),
                name: "test.md".into(),
                content: "# Test".into(),
            },
        };
        let value = serde_json::to_value(target).expect("serialize launch target");
        assert_eq!(value["kind"], "file");
        assert_eq!(value["document"]["name"], "test.md");
    }

    #[test]
    fn invalid_launch_result_survives_until_frontend_reads_it_once() {
        let root = workspace_fixture();
        let path = root.join("SYNTHETIC_invalid_startup.md");
        fs::write(&path, b"\xff\xfe").unwrap();
        let state = FileAccessState::with_pending(launch_target_from_paths([path.clone()]));
        assert!(!state.is_authorized(&path));
        assert_eq!(
            state.take_launch_target().unwrap_err(),
            "仅支持 UTF-8 编码的 Markdown 文件"
        );
        assert!(state.take_launch_target().unwrap().is_none());
        assert_eq!(fs::read(&path).unwrap(), b"\xff\xfe");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn newer_launch_success_replaces_a_pending_error_and_authorizes_its_file() {
        let root = workspace_fixture();
        let path = root.join("SYNTHETIC_recovery.md");
        fs::write(&path, "# SYNTHETIC recovery").unwrap();
        let state = FileAccessState::with_pending(Err("SYNTHETIC old startup error".into()));
        state.set_launch_target(launch_target_from_path(&path).unwrap());
        assert!(state.is_authorized(&fs::canonicalize(&path).unwrap()));
        match state.take_launch_target().unwrap().unwrap() {
            LaunchTarget::File { document } => assert_eq!(document.content, "# SYNTHETIC recovery"),
            _ => panic!("expected the latest file"),
        }
        assert!(state.take_launch_target().unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn newer_launch_error_replaces_a_pending_success_without_reopening_it() {
        let root = workspace_fixture();
        let path = root.join("SYNTHETIC_old_target.md");
        fs::write(&path, "# SYNTHETIC old target").unwrap();
        let state = FileAccessState::with_pending(launch_target_from_paths([path]));
        state.set_launch_error("SYNTHETIC latest startup error".into());
        assert_eq!(
            state.take_launch_target().unwrap_err(),
            "SYNTHETIC latest startup error"
        );
        assert!(state.take_launch_target().unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_open_reports_invalid_encoding_without_changing_the_file() {
        let root = workspace_fixture();
        let path = root.join("SYNTHETIC_invalid.md");
        let bytes = b"# SYNTHETIC invalid UTF-8\n\xff\xfe\x80";
        fs::write(&path, bytes).unwrap();
        assert_eq!(
            launch_target_from_paths([path.clone()]).unwrap_err(),
            "仅支持 UTF-8 编码的 Markdown 文件"
        );
        assert_eq!(fs::read(path).unwrap(), bytes);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_open_keeps_the_first_valid_target_when_other_paths_fail() {
        let root = workspace_fixture();
        let invalid = root.join("SYNTHETIC_invalid.md");
        let valid = root.join("SYNTHETIC_valid.md");
        fs::write(&invalid, b"\xff").unwrap();
        fs::write(&valid, "# SYNTHETIC valid document").unwrap();
        let target = launch_target_from_paths([invalid, valid.clone(), root.clone()])
            .unwrap()
            .unwrap();
        match target {
            LaunchTarget::File { document } => {
                assert_eq!(document.path, valid.to_string_lossy());
                assert_eq!(document.content, "# SYNTHETIC valid document");
            }
            _ => panic!("Expected the first valid file before the folder"),
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_open_without_local_paths_has_no_target_or_error() {
        assert!(launch_target_from_paths([]).unwrap().is_none());
    }
    #[test]
    fn external_write_in_commit_window_keeps_both_versions_and_reports_recovery() {
        for replace in [false, true] {
            let root = workspace_fixture();
            let destination = root.join("SYNTHETIC_竞争.md");
            fs::write(&destination, b"SYNTHETIC original").unwrap();
            let result = write_document_before_commit(
                &destination,
                b"SYNTHETIC local edit",
                Some(b"SYNTHETIC original"),
                |path| {
                    let path = path.to_owned();
                    std::thread::spawn(move || {
                        if replace {
                            let incoming = path.with_extension("incoming");
                            fs::write(&incoming, b"SYNTHETIC external edit").unwrap();
                            fs::rename(incoming, path).unwrap();
                        } else {
                            fs::write(path, b"SYNTHETIC external edit").unwrap();
                        }
                    })
                    .join()
                    .unwrap();
                },
            )
            .unwrap_err();
            assert!(result.starts_with("保存期间文件状态发生变化。"));
            assert_eq!(fs::read(&destination).unwrap(), b"SYNTHETIC local edit");
            let backups: Vec<_> = fs::read_dir(&root)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .filter(|path| path != &destination)
                .collect();
            assert_eq!(backups.len(), 1);
            assert_eq!(fs::read(&backups[0]).unwrap(), b"SYNTHETIC external edit");
            assert!(is_markdown(&backups[0]));
            assert!(result.contains(&backups[0].to_string_lossy().to_string()));
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn deletion_in_commit_window_is_not_silently_resurrected() {
        let root = workspace_fixture();
        let destination = root.join("SYNTHETIC_deleted.md");
        fs::write(&destination, b"SYNTHETIC original").unwrap();
        let result = write_document_before_commit(
            &destination,
            b"SYNTHETIC edit",
            Some(b"SYNTHETIC original"),
            |path| {
                fs::remove_file(path).unwrap();
            },
        );
        assert!(result.is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preexisting_conflict_never_reaches_commit_or_creates_recovery_copy() {
        let root = workspace_fixture();
        let destination = root.join("SYNTHETIC_stale.md");
        fs::write(&destination, b"SYNTHETIC external edit").unwrap();
        let result = write_document_before_commit(
            &destination,
            b"SYNTHETIC edit",
            Some(b"SYNTHETIC original"),
            |_| {
                panic!("a stale document must never reach commit");
            },
        );
        assert_eq!(result, Err(EXTERNAL_CHANGE.into()));
        assert_eq!(fs::read(&destination).unwrap(), b"SYNTHETIC external edit");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_naming_failure_retains_the_displaced_version() {
        let root = workspace_fixture();
        let displaced = root.join("SYNTHETIC_displaced.tmp");
        fs::write(&displaced, b"SYNTHETIC external edit").unwrap();
        let result = recovery_notice(&root.join("missing/SYNTHETIC.md"), &displaced);
        assert_eq!(fs::read(&displaced).unwrap(), b"SYNTHETIC external edit");
        assert!(result.contains(&displaced.to_string_lossy().to_string()));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_safe_replacement_keeps_permissions_without_leaking_backups() {
        use std::os::unix::fs::PermissionsExt;
        let root = workspace_fixture();
        let destination = root.join("SYNTHETIC_modes.md");
        fs::write(&destination, b"SYNTHETIC original").unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o640)).unwrap();
        write_document_atomically(&destination, b"SYNTHETIC edit", Some(b"SYNTHETIC original"))
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"SYNTHETIC edit");
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_new_target_created_during_save_is_not_overwritten() {
        let root = workspace_fixture();
        let destination = root.join("SYNTHETIC_new.md");
        assert_eq!(save_as_baseline(&destination).unwrap(), None);
        let result = write_document_before_commit(&destination, b"SYNTHETIC local", None, |path| {
            fs::write(path, b"SYNTHETIC external new file").unwrap();
        });
        assert_eq!(result, Err(EXTERNAL_CHANGE.into()));
        assert_eq!(
            fs::read(&destination).unwrap(),
            b"SYNTHETIC external new file"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_as_baseline_preserves_bytes_for_replacement_and_allows_new_creation() {
        let root = workspace_fixture();
        let destination = root.join("SYNTHETIC_new.md");
        write_document_atomically(&destination, "SYNTHETIC 中文\r\n".as_bytes(), None).unwrap();
        let baseline = save_as_baseline(&destination).unwrap().unwrap();
        assert_eq!(baseline, "SYNTHETIC 中文\r\n".as_bytes());
        write_document_atomically(&destination, b"SYNTHETIC replacement", Some(&baseline)).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"SYNTHETIC replacement");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_as_rejects_directories_and_oversized_existing_targets() {
        let root = workspace_fixture();
        assert!(save_as_baseline(&root).is_err());
        let destination = root.join("SYNTHETIC_large.md");
        File::create(&destination)
            .unwrap()
            .set_len(MAX_DOCUMENT_BYTES + 1)
            .unwrap();
        assert!(save_as_baseline(&destination)
            .unwrap_err()
            .contains("16 MB"));
        assert_eq!(
            fs::metadata(&destination).unwrap().len(),
            MAX_DOCUMENT_BYTES + 1
        );
        fs::remove_dir_all(root).unwrap();
    }
}
