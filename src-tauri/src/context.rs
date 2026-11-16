//! Read-only, explicitly selected folder context. Absolute paths stay native.
use crate::files::AiContextDocument;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;

const MAX_FILES: usize = 2_000;
const MAX_VISITED: usize = 20_000;
const MAX_DEPTH: usize = 12;
const MAX_SELECTED: usize = 12;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IGNORE_BYTES: u64 = 128 * 1024;
const MAX_FOLDERS: usize = 32;
static FOLDER_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextFile {
    path: String,
    name: String,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextFolder {
    id: String,
    name: String,
    files: Vec<AiContextFile>,
    truncated: bool,
}

#[derive(Clone)]
struct AuthorizedFolder {
    root: PathBuf,
    // Retaining the directory handle keeps Unix reads anchored to the selected
    // directory even if its path changes. Windows denies directory replacement.
    handle: Arc<File>,
    paths: HashSet<String>,
}

#[derive(Default)]
pub struct AiContextState {
    folders: Mutex<HashMap<String, AuthorizedFolder>>,
}

impl AiContextState {
    fn folder(&self, id: &str) -> Result<AuthorizedFolder, String> {
        self.folders
            .lock()
            .map_err(|_| "无法读取上下文授权".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| "该上下文文件夹尚未授权或已移除".to_string())
    }
}

fn relative_name(path: &Path) -> Option<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(name) => name
                .to_str()
                .filter(|name| !name.contains(['\\', ':']))
                .map(str::to_owned),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && relative_name(Path::new(path)).as_deref() == Some(path)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn excluded_name(name: &str, directory: bool) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with('.') {
        return true;
    }
    if directory
        && [
            "node_modules",
            "target",
            "dist",
            "build",
            "out",
            "coverage",
            "vendor",
            "artifacts",
            "outputs",
            "__pycache__",
        ]
        .contains(&lower.as_str())
    {
        return true;
    }
    lower.split(['.', '-', '_']).any(|part| {
        [
            "secret",
            "secrets",
            "credential",
            "credentials",
            "token",
            "tokens",
        ]
        .contains(&part)
    }) || [
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "cargo.lock",
    ]
    .contains(&lower.as_str())
}

fn supported_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if excluded_name(name, false) {
        return false;
    }
    if ["readme", "license", "makefile", "dockerfile", "justfile"]
        .contains(&name.to_ascii_lowercase().as_str())
    {
        return true;
    }
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            [
                "md",
                "markdown",
                "mdown",
                "mkdn",
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
            ]
            .contains(&extension.to_ascii_lowercase().as_str())
        })
}

fn authorize_root(path: &Path) -> Result<AuthorizedFolder, String> {
    let root = fs::canonicalize(path).map_err(|_| "无法访问上下文文件夹".to_string())?;
    if !root.is_dir() {
        return Err("上下文必须选择文件夹".to_string());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
            FILE_SHARE_WRITE,
        };
        options
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    }
    let handle = options
        .open(&root)
        .map_err(|_| "无法打开上下文文件夹".to_string())?;
    Ok(AuthorizedFolder {
        root,
        handle: Arc::new(handle),
        paths: HashSet::new(),
    })
}

// Each component is opened without following links, relative to an already
// opened directory. No frontend-provided absolute path is ever accepted.
#[cfg(unix)]
fn open_relative(folder: &AuthorizedFolder, path: &str) -> Result<File, String> {
    use std::{
        ffi::CString,
        os::fd::{AsRawFd, FromRawFd},
    };
    if !valid_relative(path) {
        return Err("上下文相对路径无效".to_string());
    }
    let components = path.split('/').collect::<Vec<_>>();
    let mut directory = folder
        .handle
        .try_clone()
        .map_err(|_| "无法打开上下文文件夹".to_string())?;
    for (index, component) in components.iter().enumerate() {
        let name = CString::new(*component).map_err(|_| "上下文相对路径无效".to_string())?;
        let flags = libc::O_RDONLY
            | libc::O_CLOEXEC
            | libc::O_NOFOLLOW
            | if index + 1 == components.len() {
                libc::O_NONBLOCK
            } else {
                libc::O_DIRECTORY
            };
        // SAFETY: directory owns a live descriptor, name is NUL-terminated, and
        // openat returns a new owned descriptor on success.
        let descriptor = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0 {
            return Err("无法读取上下文文件，文件可能已移动或包含符号链接".to_string());
        }
        directory = unsafe { File::from_raw_fd(descriptor) };
    }
    if !directory
        .metadata()
        .map_err(|_| "无法读取上下文文件信息".to_string())?
        .is_file()
    {
        return Err("上下文只能读取普通文件".to_string());
    }
    Ok(directory)
}

#[cfg(windows)]
fn open_relative(folder: &AuthorizedFolder, path: &str) -> Result<File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    if !valid_relative(path) {
        return Err("上下文相对路径无效".to_string());
    }
    let mut location = folder.root.clone();
    let mut parents = Vec::new();
    let components = path.split('/').collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        location.push(component);
        // Denying FILE_SHARE_DELETE pins each traversed directory against
        // replacement until the final file handle has been opened.
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&location)
            .map_err(|_| "无法读取上下文文件".to_string())?;
        let metadata = file
            .metadata()
            .map_err(|_| "无法读取上下文文件信息".to_string())?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("上下文不能读取符号链接或目录联接".to_string());
        }
        if index + 1 == components.len() {
            if !metadata.is_file() {
                return Err("上下文只能读取普通文件".to_string());
            }
            return Ok(file);
        }
        if !metadata.is_dir() {
            return Err("上下文相对路径无效".to_string());
        }
        parents.push(file);
    }
    Err("上下文相对路径无效".to_string())
}

fn read_bounded(folder: &AuthorizedFolder, path: &str, limit: u64) -> Result<String, String> {
    let file = open_relative(folder, path)?;
    if file
        .metadata()
        .map_err(|_| "无法读取上下文文件信息".to_string())?
        .len()
        > limit
    {
        return Err("上下文文件超过大小限制".to_string());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取上下文文件".to_string())?;
    if bytes.len() as u64 > limit {
        return Err("上下文文件超过大小限制".to_string());
    }
    if bytes.contains(&0) {
        return Err("上下文不能包含二进制内容".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "上下文文件必须使用 UTF-8 编码".to_string())
}

struct Scan {
    files: Vec<AiContextFile>,
    visited: usize,
    truncated: bool,
}

fn scan_directory(
    folder: &AuthorizedFolder,
    relative: &Path,
    depth: usize,
    inherited: &[Gitignore],
    scan: &mut Scan,
) -> Result<(), String> {
    let directory = folder.root.join(relative);
    let metadata =
        fs::symlink_metadata(&directory).map_err(|_| "无法扫描上下文文件夹".to_string())?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err("上下文文件夹已移动或包含符号链接".to_string());
    }
    let mut ignores = inherited.to_vec();
    let ignore_path = relative.join(".gitignore");
    match fs::symlink_metadata(folder.root.join(&ignore_path)) {
        Ok(metadata) => {
            if is_link(&metadata) || !metadata.is_file() {
                return Err("上下文 .gitignore 必须是普通文件".to_string());
            }
            let name = relative_name(&ignore_path).ok_or_else(|| "上下文路径无效".to_string())?;
            let source = read_bounded(folder, &name, MAX_IGNORE_BYTES)?;
            let mut builder = GitignoreBuilder::new(&directory);
            for line in source.lines() {
                builder
                    .add_line(None, line)
                    .map_err(|_| "无法解析上下文 .gitignore".to_string())?;
            }
            ignores.push(
                builder
                    .build()
                    .map_err(|_| "无法解析上下文 .gitignore".to_string())?,
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("无法读取上下文 .gitignore".to_string()),
    }
    let budget = MAX_VISITED.saturating_sub(scan.visited);
    let mut entries = fs::read_dir(&directory)
        .map_err(|_| "无法扫描上下文文件夹".to_string())?
        .take(budget + 1)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "无法扫描上下文文件夹".to_string())?;
    if entries.len() > budget {
        entries.truncate(budget);
        scan.truncated = true;
    }
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if scan.visited >= MAX_VISITED || scan.files.len() >= MAX_FILES {
            scan.truncated = true;
            break;
        }
        scan.visited += 1;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            scan.truncated = true;
            continue;
        };
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "上下文文件在扫描期间发生变化，请刷新".to_string())?;
        if is_link(&metadata) || excluded_name(name, metadata.is_dir()) {
            continue;
        }
        let ignored = ignores
            .iter()
            .rev()
            .find_map(|ignore| {
                let matched = ignore.matched_path_or_any_parents(entry.path(), metadata.is_dir());
                if matched.is_ignore() {
                    Some(true)
                } else if matched.is_whitelist() {
                    Some(false)
                } else {
                    None
                }
            })
            .unwrap_or(false);
        if ignored {
            continue;
        }
        let next = relative.join(name);
        if metadata.is_dir() {
            if depth >= MAX_DEPTH {
                scan.truncated = true;
                continue;
            }
            scan_directory(folder, &next, depth + 1, &ignores, scan)?;
        } else if metadata.is_file() && metadata.len() <= MAX_FILE_BYTES && supported_file(&next) {
            if let Some(path) = relative_name(&next) {
                scan.files.push(AiContextFile {
                    name: path.clone(),
                    path,
                    bytes: metadata.len(),
                });
            }
        }
    }
    Ok(())
}

fn scan_folder(id: &str, folder: &AuthorizedFolder) -> Result<AiContextFolder, String> {
    // Refuse a replaced root instead of silently attaching a different folder.
    let current = fs::symlink_metadata(&folder.root)
        .map_err(|_| "上下文文件夹已移动，请重新选择".to_string())?;
    if is_link(&current) || !current.is_dir() {
        return Err("上下文文件夹已移动，请重新选择".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let selected = folder
            .handle
            .metadata()
            .map_err(|_| "无法读取上下文文件夹".to_string())?;
        if current.dev() != selected.dev() || current.ino() != selected.ino() {
            return Err("上下文文件夹已替换，请重新选择".to_string());
        }
    }
    let mut scan = Scan {
        files: Vec::new(),
        visited: 0,
        truncated: false,
    };
    scan_directory(folder, Path::new(""), 0, &[], &mut scan)?;
    scan.files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(AiContextFolder {
        id: id.to_string(),
        name: folder
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Context")
            .to_string(),
        files: scan.files,
        truncated: scan.truncated,
    })
}

fn read_selected(
    id: &str,
    folder: &AuthorizedFolder,
    paths: &[String],
) -> Result<Vec<AiContextDocument>, String> {
    if paths.len() > MAX_SELECTED {
        return Err("一次最多选择 12 个上下文文件".to_string());
    }
    let unique = paths.iter().collect::<HashSet<_>>();
    if unique.len() != paths.len() {
        return Err("上下文文件不能重复选择".to_string());
    }
    for path in paths {
        if !valid_relative(path) || !folder.paths.contains(path) {
            return Err("该文件不在已授权的上下文列表中，请刷新文件夹".to_string());
        }
    }
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    // Re-evaluate ignore rules and file types before every request; a file
    // newly excluded by .gitignore must not leak through an old UI selection.
    let current = scan_folder(id, folder)?;
    let available = current
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<HashSet<_>>();
    paths
        .iter()
        .map(|path| {
            if !available.contains(path.as_str()) {
                return Err("上下文文件已移除、忽略或超过限制，请刷新文件夹".to_string());
            }
            Ok(AiContextDocument {
                path: format!("{id}/{path}"),
                name: path.clone(),
                content: read_bounded(folder, path, MAX_FILE_BYTES)?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn pick_ai_context_folder(
    state: State<'_, AiContextState>,
) -> Result<Option<AiContextFolder>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };
    let selected = handle.path().to_path_buf();
    let (mut folder, result) = tauri::async_runtime::spawn_blocking(move || {
        let folder = authorize_root(&selected)?;
        let id = format!(
            "context-folder-{}",
            FOLDER_NONCE.fetch_add(1, Ordering::Relaxed)
        );
        let result = scan_folder(&id, &folder)?;
        Ok::<_, String>((folder, result))
    })
    .await
    .map_err(|_| "无法扫描上下文文件夹".to_string())??;
    folder.paths = result.files.iter().map(|file| file.path.clone()).collect();
    let mut folders = state
        .folders
        .lock()
        .map_err(|_| "无法保存上下文授权".to_string())?;
    if folders.len() >= MAX_FOLDERS {
        return Err("上下文文件夹数量达到上限，请先移除现有文件夹".to_string());
    }
    folders.insert(result.id.clone(), folder);
    Ok(Some(result))
}

#[tauri::command]
pub async fn refresh_ai_context_folder(
    folder_id: String,
    state: State<'_, AiContextState>,
) -> Result<AiContextFolder, String> {
    let folder = state.folder(&folder_id)?;
    let id = folder_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || scan_folder(&id, &folder))
        .await
        .map_err(|_| "无法刷新上下文文件夹".to_string())??;
    let mut folders = state
        .folders
        .lock()
        .map_err(|_| "无法保存上下文授权".to_string())?;
    let folder = folders
        .get_mut(&folder_id)
        .ok_or_else(|| "上下文文件夹已移除".to_string())?;
    folder.paths = result.files.iter().map(|file| file.path.clone()).collect();
    Ok(result)
}

#[tauri::command]
pub async fn read_ai_context_folder_files(
    folder_id: String,
    paths: Vec<String>,
    state: State<'_, AiContextState>,
) -> Result<Vec<AiContextDocument>, String> {
    let folder = state.folder(&folder_id)?;
    tauri::async_runtime::spawn_blocking(move || read_selected(&folder_id, &folder, &paths))
        .await
        .map_err(|_| "无法读取上下文文件".to_string())?
}

#[tauri::command]
pub fn release_ai_context_folder(
    folder_id: String,
    state: State<'_, AiContextState>,
) -> Result<(), String> {
    state
        .folders
        .lock()
        .map_err(|_| "无法移除上下文授权".to_string())?
        .remove(&folder_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "prosemap-synthetic-context-{}-{}",
                std::process::id(),
                FOLDER_NONCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
        fn write(&self, name: &str, content: &str) {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        fn authorized(&self) -> AuthorizedFolder {
            let mut folder = authorize_root(&self.0).unwrap();
            folder.paths = scan_folder("synthetic-folder", &folder)
                .unwrap()
                .files
                .into_iter()
                .map(|file| file.path)
                .collect();
            folder
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn inventory_respects_nested_gitignore_and_excludes_secrets_and_generated_files() {
        let fixture = Fixture::new();
        fixture.write(".gitignore", "ignored/\n*.tmp\n*.json\n");
        fixture.write("src/.gitignore", "!keep.json\n");
        for path in [
            "README.md",
            "src/main.rs",
            "src/keep.json",
            "src/drop.json",
            "ignored/notes.md",
            "node_modules/example/index.ts",
            "target/example.rs",
            ".env",
            "credentials.json",
            "src/secret.yaml",
            "binary.png",
        ] {
            fixture.write(path, "synthetic");
        }
        let folder = fixture.authorized();
        assert_eq!(
            folder.paths,
            ["README.md", "src/main.rs", "src/keep.json"]
                .into_iter()
                .map(str::to_owned)
                .collect()
        );
        let wire =
            serde_json::to_string(&scan_folder("synthetic-folder", &folder).unwrap()).unwrap();
        assert!(!wire.contains(&fixture.0.to_string_lossy().to_string()));
    }

    #[test]
    fn reads_fresh_content_and_rejects_new_ignore_rules_missing_and_unlisted_files() {
        let fixture = Fixture::new();
        fixture.write("source.ts", "synthetic old");
        let folder = fixture.authorized();
        fixture.write("source.ts", "synthetic new");
        let selected = vec!["source.ts".to_string()];
        let documents = read_selected("synthetic-folder", &folder, &selected).unwrap();
        assert_eq!(documents[0].content, "synthetic new");
        assert_eq!(documents[0].name, "source.ts");
        assert_eq!(documents[0].path, "synthetic-folder/source.ts");
        fixture.write("new.md", "synthetic");
        assert!(read_selected("synthetic-folder", &folder, &["new.md".to_string()]).is_err());
        fixture.write(".gitignore", "source.ts\n");
        assert!(read_selected("synthetic-folder", &folder, &selected).is_err());
        fs::remove_file(fixture.0.join("source.ts")).unwrap();
        assert!(read_selected("synthetic-folder", &folder, &selected).is_err());
    }

    #[test]
    fn rejects_traversal_duplicates_unknown_authority_and_nontext_content() {
        let fixture = Fixture::new();
        fixture.write("source.ts", "synthetic");
        let folder = fixture.authorized();
        for path in [
            "../source.ts",
            "/source.ts",
            "src/../source.ts",
            "src//source.ts",
            "C:/source.ts",
            "src\\source.ts",
            "./source.ts",
        ] {
            assert!(!valid_relative(path));
            assert!(read_selected("synthetic-folder", &folder, &[path.to_string()]).is_err());
        }
        assert!(read_selected(
            "synthetic-folder",
            &folder,
            &vec!["source.ts".to_string(); 2]
        )
        .is_err());
        assert!(read_selected(
            "synthetic-folder",
            &folder,
            &vec!["source.ts".to_string(); MAX_SELECTED + 1]
        )
        .is_err());
        assert!(AiContextState::default().folder("unknown").is_err());
        fs::write(fixture.0.join("source.ts"), b"synthetic\0binary").unwrap();
        assert!(read_selected("synthetic-folder", &folder, &["source.ts".to_string()]).is_err());
        fs::write(fixture.0.join("source.ts"), [0xff]).unwrap();
        assert!(read_selected("synthetic-folder", &folder, &["source.ts".to_string()]).is_err());
    }

    #[test]
    fn scans_are_bounded_and_report_incomplete_inventory() {
        let fixture = Fixture::new();
        for index in 0..MAX_FILES + 1 {
            fixture.write(&format!("synthetic-{index:04}.md"), "synthetic");
        }
        let folder = authorize_root(&fixture.0).unwrap();
        let scan = scan_folder("synthetic-folder", &folder).unwrap();
        assert_eq!(scan.files.len(), MAX_FILES);
        assert!(scan.truncated);
    }

    #[test]
    fn oversized_files_and_ignore_files_fail_closed() {
        let fixture = Fixture::new();
        fixture.write("source.ts", "synthetic");
        let folder = fixture.authorized();
        fs::OpenOptions::new()
            .write(true)
            .open(fixture.0.join("source.ts"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(read_selected("synthetic-folder", &folder, &["source.ts".to_string()]).is_err());
        fixture.write(".gitignore", "# synthetic\n");
        fs::OpenOptions::new()
            .write(true)
            .open(fixture.0.join(".gitignore"))
            .unwrap()
            .set_len(MAX_IGNORE_BYTES + 1)
            .unwrap();
        assert!(scan_folder("synthetic-folder", &folder).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_replaced_roots_cannot_expose_outside_content() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        fixture.write("src/main.ts", "synthetic inside");
        outside.write("main.ts", "synthetic outside");
        symlink(outside.0.join("main.ts"), fixture.0.join("linked.ts")).unwrap();
        symlink(&outside.0, fixture.0.join("linked-directory")).unwrap();
        let folder = fixture.authorized();
        assert_eq!(
            folder.paths,
            ["src/main.ts".to_string()].into_iter().collect()
        );
        fs::remove_dir_all(fixture.0.join("src")).unwrap();
        symlink(&outside.0, fixture.0.join("src")).unwrap();
        assert!(open_relative(&folder, "src/main.ts").is_err());
        assert!(read_selected("synthetic-folder", &folder, &["src/main.ts".to_string()]).is_err());
        symlink(outside.0.join("main.ts"), fixture.0.join(".gitignore")).unwrap();
        assert!(scan_folder("synthetic-folder", &folder).is_err());
        fs::remove_file(fixture.0.join(".gitignore")).unwrap();
        let moved = fixture.0.with_extension("moved");
        fs::rename(&fixture.0, &moved).unwrap();
        fs::create_dir(&fixture.0).unwrap();
        assert!(scan_folder("synthetic-folder", &folder).is_err());
        fs::remove_dir_all(moved).unwrap();
    }
}
