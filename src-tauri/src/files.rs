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
const MAX_WORKSPACE_FILES: usize = 2_000;
const MAX_WORKSPACE_DEPTH: usize = 12;
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkdn"];
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
    fn recognizes_supported_markdown_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("notes.MD")));
        assert!(is_markdown(Path::new("notes.markdown")));
        assert!(!is_markdown(Path::new("notes.txt")));
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
