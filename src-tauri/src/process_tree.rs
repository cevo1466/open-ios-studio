//! Unix process groups and Windows kill-on-close Job Objects for owned tool processes.
use std::io;
use std::process::{Child, Command};

pub struct ProcessTree {
    #[cfg(windows)]
    job: std::os::windows::io::OwnedHandle,
}

pub fn prepare(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
}

impl ProcessTree {
    pub fn attach(child: &mut Child) -> io::Result<Self> {
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
            use windows_sys::Win32::System::JobObjects::*;
            // SAFETY: unnamed job, initialized limits and borrowed child handle remain valid
            // during each call. OwnedHandle closes the unique job handle on every error path.
            unsafe {
                let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if raw.is_null() {
                    let error = io::Error::last_os_error();
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                let job = OwnedHandle::from_raw_handle(raw);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    raw,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                ) == 0
                    || AssignProcessToJobObject(raw, child.as_raw_handle()) == 0
                {
                    let error = io::Error::last_os_error();
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                Ok(Self { job })
            }
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Self {})
        }
    }

    pub fn terminate(&self, child: &mut Child, hard: bool) {
        #[cfg(unix)]
        {
            let signal = if hard { libc::SIGKILL } else { libc::SIGTERM };
            if let Ok(pid) = i32::try_from(child.id()) {
                // SAFETY: prepare made this owned child the process-group leader.
                unsafe {
                    libc::kill(-pid, signal);
                }
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let _ = (child, hard);
            // SAFETY: the job handle is owned by self and remains valid for this call.
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    self.job.as_raw_handle(),
                    1,
                );
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            if hard {
                let _ = child.kill();
            }
        }
    }
}
