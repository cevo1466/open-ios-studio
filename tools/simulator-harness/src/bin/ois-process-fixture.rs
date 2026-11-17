//! Test child used to verify Windows descendant cleanup without shell commands.
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args[1] == "parent" {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["child", &args[2]])
            .spawn()
            .unwrap();
        println!("child:{}", child.id());
        let _ = child.wait();
    } else {
        std::thread::sleep(std::time::Duration::from_secs(2));
        std::fs::write(&args[2], "descendant survived").unwrap();
    }
}
