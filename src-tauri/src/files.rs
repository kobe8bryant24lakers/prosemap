use serde::Serialize;
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::State;

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
    pending_launch: Mutex<Option<LaunchTarget>>,
}

impl FileAccessState {
    pub fn with_pending(target: Option<LaunchTarget>) -> Self {
        let state = Self::default();
        if let Some(target) = target {
            state.authorize_target(&target);
            *state.pending_launch.lock().expect("pending launch lock") = Some(target);
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
        *self.pending_launch.lock().expect("pending launch lock") = Some(target);
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

fn collect_markdown_files(root: &Path) -> Vec<LocalFileEntry> {
    fn visit(root: &Path, directory: &Path, depth: usize, files: &mut Vec<LocalFileEntry>) {
        if depth > MAX_WORKSPACE_DEPTH || files.len() >= MAX_WORKSPACE_FILES {
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
                    visit(root, &path, depth + 1, files);
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
        }
    }

    let mut files = Vec::new();
    visit(root, root, 0, &mut files);
    files.sort_by_key(|entry| entry.relative_path.to_lowercase());
    files
}

fn workspace_from_canonical(root: &Path) -> Result<LocalWorkspace, String> {
    if !root.is_dir() {
        return Err("请选择文件夹".to_string());
    }
    Ok(LocalWorkspace {
        root: root.to_string_lossy().into_owned(),
        name: display_name(root, "Markdown Workspace"),
        files: collect_markdown_files(root),
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

pub fn launch_target_from_args() -> Option<LaunchTarget> {
    std::env::args_os()
        .skip(1)
        .filter(|argument| !argument.to_string_lossy().starts_with('-'))
        .find_map(|argument| launch_target_from_path(Path::new(&argument)).ok())
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
    let source = source.replace('\\', "/");
    if source.is_empty()
        || source.starts_with('/')
        || source.starts_with('#')
        || url::Url::parse(&source).is_ok()
    {
        return Err("仅支持相对路径图片".into());
    }
    let base = url::Url::from_file_path(document).map_err(|_| "文档路径无效")?;
    let resolved = base.join(&source).map_err(|_| "图片路径无效")?;
    resolved.to_file_path().map_err(|_| "图片路径无效".into())
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

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(temporary: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_document_atomically(destination: &Path, content: &[u8]) -> Result<(), String> {
    let (temporary, mut file) = create_temporary_sibling(destination)
        .map_err(|_| "无法在目标文件夹创建安全的临时文件".to_string())?;
    let result = (|| -> io::Result<()> {
        file.write_all(content)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(destination) {
            fs::set_permissions(&temporary, metadata.permissions())?;
        }
        drop(file);
        replace_file_atomically(&temporary, destination)?;
        #[cfg(unix)]
        if let Some(directory) = destination.parent() {
            let _ = File::open(directory).and_then(|handle| handle.sync_all());
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| "无法安全保存该 Markdown 文件；原文件保持不变".to_string())
}

#[tauri::command]
pub async fn save_local_markdown(
    path: Option<String>,
    suggested_name: String,
    content: String,
    state: State<'_, FileAccessState>,
) -> Result<Option<LocalDocument>, String> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Markdown 文件不能超过 16 MB".to_string());
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

    write_document_atomically(&destination, content.as_bytes())?;
    let canonical = canonical_existing(&destination)?;
    state.authorize_file(canonical.clone());
    document_from_canonical(&canonical).map(Some)
}

#[tauri::command]
pub fn read_launch_target(state: State<'_, FileAccessState>) -> Option<LaunchTarget> {
    state
        .pending_launch
        .lock()
        .expect("pending launch lock")
        .take()
}

#[cfg(test)]
mod tests {
    use super::*;

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

        write_document_atomically(&destination, "完整的新内容".as_bytes()).expect("atomic save");
        assert_eq!(
            fs::read_to_string(&destination).expect("read replacement"),
            "完整的新内容"
        );

        fs::remove_dir_all(directory).expect("remove test directory");
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
}
