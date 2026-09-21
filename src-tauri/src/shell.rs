//! 子进程统一入口：Windows 下附加 CREATE_NO_WINDOW，杜绝控制台黑窗弹出。
//! 所有 docker / 系统命令都必须经这里创建，错误输出由调用方流入日志面板。

/// Windows 进程创建标志：不分配控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 异步 docker 命令（tokio），带管道输出能力
pub fn docker_cmd() -> tokio::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut c = tokio::process::Command::new("docker");
    // tokio::process::Command 在 Windows 上的原生方法（stable），无需导入 trait
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// 同步系统命令（std），用于 open / explorer / xdg-open 等
pub fn std_cmd(program: &str) -> std::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}
