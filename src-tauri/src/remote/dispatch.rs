//! Requests from a paired device, run by the same functions as the local frontend's `invoke` calls.
//!
//! Deny by default: only the commands listed in [`required_level`] can be called remotely, each with the minimum
//! [`AccessLevel`] it needs. Native dialogs, opening files/folders on this machine, installing or signing in the
//! CLIs, app settings, notifications and windows are never exposed.

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::commands::{dashboard, memory, projects, threads};
use crate::db::remote::AccessLevel;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Shared};

const BYPASS: &str = "bypassPermissions";

/// Minimum level a remote call needs, `None` when the command is not available remotely. Some arguments raise
/// the level: « Tout autoriser » and an arbitrary working directory need [`AccessLevel::Full`].
pub fn required_level(method: &str, args: &Value) -> Option<AccessLevel> {
    use AccessLevel::{Chat, Full, Read};
    let str_at = |pointer: &str| args.pointer(pointer).and_then(Value::as_str);
    let level = match method {
        "dashboard_snapshot"
        | "usage_report"
        | "refresh_quotas"
        | "list_projects"
        | "list_threads"
        | "get_thread"
        | "get_thread_history"
        | "running_threads"
        | "prompt_history"
        | "default_cwd"
        | "list_slash_commands"
        | "list_models"
        | "agent_access"
        | "agent_images"
        | "project_context"
        | "project_overview"
        | "thread_context"
        | "list_memories"
        | "search_memories"
        | "search_messages"
        | "read_attachment" => Read,
        "create_thread" => {
            // A folder of the remote device's choosing (not one of its projects) = run an agent anywhere.
            let anywhere = args.pointer("/input/cwd").is_some_and(|v| !v.is_null());
            if anywhere || str_at("/input/permissionMode") == Some(BYPASS) { Full } else { Chat }
        }
        "update_thread_settings" => {
            if str_at("/settings/permissionMode") == Some(BYPASS) {
                Full
            } else {
                Chat
            }
        }
        "respond_permission" => {
            if str_at("/mode") == Some(BYPASS) {
                Full
            } else {
                Chat
            }
        }
        "send_message"
        | "paste_attachment"
        | "stop_thread"
        | "rename_thread"
        | "restore_thread"
        | "set_thread_pinned"
        | "set_thread_archived"
        | "save_project_context" => Chat,
        // Browsing folders shows the host's disk: same level as creating a project there.
        "delete_thread"
        | "move_thread"
        | "create_project"
        | "create_project_folder"
        | "rename_project"
        | "list_directory"
        | "delete_project"
        | "create_memory"
        | "update_memory"
        | "delete_memory"
        | "update_provider" => Full,
        _ => return None,
    };
    Some(level)
}

/// One argument by its camelCase name (a missing optional argument is `None`).
pub(crate) fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> AppResult<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| AppError::Invalid(format!("{key}: {e}")))
}

pub(crate) fn json<T: serde::Serialize>(value: T) -> AppResult<Value> {
    Ok(serde_json::to_value(value)?)
}

/// A file of a chat (attachment, image its agent made) for a paired device to display.
async fn read_attachment(
    state: &AppState,
    thread_id: String,
    path: String,
) -> AppResult<crate::attachments::SharedFile> {
    let root = crate::attachments::root(&state.paths.data_dir);
    let id = thread_id.clone();
    let thread = state
        .db
        .call(move |c| crate::db::threads::get(c, &id))
        .await?
        .ok_or_else(|| AppError::NotFound(format!("thread {thread_id}")))?;
    let cwd = thread.cwd.map(std::path::PathBuf::from);
    tokio::task::spawn_blocking(move || crate::attachments::read_shared(&root, cwd.as_deref(), &path)).await?
}

/// Runs a remote call with the caller's level.
pub async fn call(state: &Shared, level: AccessLevel, method: &str, args: Value) -> AppResult<Value> {
    let Some(needed) = required_level(method, &args) else {
        return Err(AppError::Invalid(crate::tr!(
            "« {method} » n'est pas disponible depuis un autre appareil",
            "“{method}” is not available from another device"
        )));
    };
    if level < needed {
        return Err(AppError::Invalid(crate::tr!(
            "droits insuffisants pour « {method} » (accordés : {}, requis : {})",
            "not allowed to run “{method}” (granted: {}, needed: {})",
            level.as_str(),
            needed.as_str()
        )));
    }
    let a = &args;
    match method {
        "dashboard_snapshot" => json(dashboard::dashboard_snapshot_inner(state, arg(a, "range")?).await?),
        "usage_report" => json(dashboard::usage_report_inner(state, arg(a, "range")?).await?),
        "refresh_quotas" => json(dashboard::refresh_quotas_inner(state).await?),
        "update_provider" => json(dashboard::update_provider_inner(state, arg(a, "update")?).await?),
        "list_projects" => json(dashboard::list_projects_inner(state).await?),
        "list_threads" => json(dashboard::list_threads_inner(state, arg(a, "limit")?).await?),
        "get_thread" => json(dashboard::get_thread_inner(state, arg(a, "id")?).await?),

        "create_thread" => json(threads::create_thread_inner(state, arg(a, "input")?).await?),
        "send_message" => json(
            threads::send_message_inner(state, arg(a, "threadId")?, arg(a, "text")?, arg(a, "attachments")?).await?,
        ),
        "list_slash_commands" => {
            json(threads::list_slash_commands_inner(state, arg(a, "agent")?, arg(a, "cwd")?).await?)
        }
        "paste_attachment" => {
            json(threads::paste_attachment_inner(state, arg(a, "name")?, arg(a, "mime")?, arg(a, "data")?).await?)
        }
        "respond_permission" => json(
            threads::respond_permission_inner(
                state,
                arg(a, "threadId")?,
                arg(a, "requestId")?,
                arg(a, "allow")?,
                arg(a, "mode")?,
                arg(a, "answers")?,
            )
            .await?,
        ),
        "stop_thread" => json(threads::stop_thread_inner(state, arg(a, "threadId")?).await?),
        "get_thread_history" => json(threads::get_thread_history_inner(state, arg(a, "threadId")?).await?),
        "rename_thread" => json(threads::rename_thread_inner(state, arg(a, "threadId")?, arg(a, "title")?).await?),
        "delete_thread" => json(threads::delete_thread_inner(state, arg(a, "threadId")?).await?),
        "restore_thread" => json(threads::restore_thread_inner(state, arg(a, "threadId")?).await?),
        "set_thread_pinned" => {
            json(threads::set_thread_pinned_inner(state, arg(a, "threadId")?, arg(a, "pinned")?).await?)
        }
        "set_thread_archived" => {
            json(threads::set_thread_archived_inner(state, arg(a, "threadId")?, arg(a, "archived")?).await?)
        }
        "move_thread" => json(threads::move_thread_inner(state, arg(a, "threadId")?, arg(a, "projectId")?).await?),
        "search_messages" => json(threads::search_messages_inner(state, arg(a, "query")?, arg(a, "limit")?).await?),
        "running_threads" => json(threads::running_threads_inner(state).await?),
        "prompt_history" => json(threads::prompt_history_inner(state, arg(a, "projectId")?).await?),
        "default_cwd" => json(threads::default_cwd_inner(state).await?),
        "update_thread_settings" => {
            json(threads::update_thread_settings_inner(state, arg(a, "threadId")?, arg(a, "settings")?).await?)
        }
        "create_project" => json(threads::create_project_inner(state, arg(a, "path")?, arg(a, "name")?).await?),
        "delete_project" => json(threads::delete_project_inner(state, arg(a, "projectId")?).await?),
        "list_directory" => json(projects::list_directory_inner(arg(a, "path")?).await?),
        "create_project_folder" => {
            json(projects::create_project_folder_inner(state, arg(a, "parent")?, arg(a, "name")?).await?)
        }
        "rename_project" => json(projects::rename_project_inner(state, arg(a, "projectId")?, arg(a, "name")?).await?),
        "list_models" => json(threads::list_models_inner(state, arg(a, "refresh")?).await?),
        "agent_images" => json(threads::agent_images_inner(state, arg(a, "threadId")?, arg(a, "paths")?).await?),

        "read_attachment" => json(read_attachment(state, arg(a, "threadId")?, arg(a, "path")?).await?),

        "agent_access" => json(crate::commands::access::agent_access(arg(a, "refresh")?).await?),

        "project_context" => json(projects::project_context_inner(state, arg(a, "projectId")?).await?),
        "save_project_context" => {
            json(projects::save_project_context_inner(state, arg(a, "projectId")?, arg(a, "content")?).await?)
        }
        "project_overview" => json(projects::project_overview_inner(state, arg(a, "projectId")?).await?),
        "thread_context" => json(projects::thread_context_inner(state, arg(a, "threadId")?).await?),

        "list_memories" => json(memory::list_memories_inner(state).await?),
        "create_memory" => json(memory::create_memory_inner(state, arg(a, "category")?, arg(a, "content")?).await?),
        "update_memory" => {
            json(memory::update_memory_inner(state, arg(a, "id")?, arg(a, "category")?, arg(a, "content")?).await?)
        }
        "delete_memory" => json(memory::delete_memory_inner(state, arg(a, "id")?).await?),
        "search_memories" => json(memory::search_memories_inner(state, arg(a, "query")?, arg(a, "limit")?).await?),

        // Listed in `required_level` but not wired here: a programming error, never a remote one.
        other => Err(AppError::Other(format!("remote method not wired: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AccessLevel::{Chat, Full, Read};
    use serde_json::json;

    #[test]
    fn levels() {
        assert_eq!(required_level("list_threads", &json!({})), Some(Read));
        assert_eq!(required_level("search_messages", &json!({"query": "rust"})), Some(Read));
        assert_eq!(required_level("send_message", &json!({"threadId": "t"})), Some(Chat));
        assert_eq!(required_level("set_thread_pinned", &json!({"threadId": "t", "pinned": true})), Some(Chat));
        assert_eq!(required_level("set_thread_archived", &json!({"threadId": "t", "archived": true})), Some(Chat));
        assert_eq!(required_level("restore_thread", &json!({"threadId": "t"})), Some(Chat));
        assert_eq!(required_level("delete_thread", &json!({})), Some(Full));
        assert_eq!(required_level("move_thread", &json!({"threadId": "t", "projectId": "p"})), Some(Full));
        assert_eq!(required_level("rename_project", &json!({"projectId": "p", "name": "New"})), Some(Full));
        // Deny by default, and local-only commands are never reachable.
        for method in ["open_folder", "update_app_settings", "install_agent", "open_memory_file", "nope", "remote_call"]
        {
            assert_eq!(required_level(method, &json!({})), None, "{method}");
        }
    }

    #[test]
    fn arguments_raise_the_level() {
        let chat = json!({"input": {"agent": "claude_code", "projectId": "p", "cwd": null}});
        assert_eq!(required_level("create_thread", &chat), Some(Chat));
        let anywhere = json!({"input": {"agent": "claude_code", "cwd": "C:/"}});
        assert_eq!(required_level("create_thread", &anywhere), Some(Full));
        let bypass = json!({"input": {"agent": "claude_code", "permissionMode": "bypassPermissions"}});
        assert_eq!(required_level("create_thread", &bypass), Some(Full));
        let settings = json!({"threadId": "t", "settings": {"permissionMode": "bypassPermissions"}});
        assert_eq!(required_level("update_thread_settings", &settings), Some(Full));
        let plan = json!({"threadId": "t", "requestId": "r", "allow": true, "mode": "acceptEdits"});
        assert_eq!(required_level("respond_permission", &plan), Some(Chat));
        let plan_bypass = json!({"threadId": "t", "requestId": "r", "allow": true, "mode": "bypassPermissions"});
        assert_eq!(required_level("respond_permission", &plan_bypass), Some(Full));
    }

    #[test]
    fn arguments_by_camel_case_name() {
        let a = json!({"threadId": "t1", "limit": 5});
        assert_eq!(arg::<String>(&a, "threadId").unwrap(), "t1");
        assert_eq!(arg::<Option<u32>>(&a, "limit").unwrap(), Some(5));
        assert_eq!(arg::<Option<String>>(&a, "projectId").unwrap(), None);
        assert!(arg::<String>(&a, "missing").is_err());
    }
}
