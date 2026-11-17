import SwiftUI

@main struct BindingDemo: App {
    var body: some Scene { WindowGroup { BindingView() } }
}

struct ChildCounter: View {
    @Binding var count: Int
    var body: some View { Button("Child add two") { count += 2 } }
}

struct BindingView: View {
    @State private var count = 5
    @State private var selection = 10
    @State private var password = ""
    var body: some View {
        VStack {
            Text("Selected: \(selection), count: \(count)")
            TabView(selection: $selection) {
                VStack {
                    ChildCounter(count: $count)
                    SecureField("Password", text: $password)
                    Text("Password length: \(password.count)")
                }.tabItem { Text("First") }.tag(10)
                List {
                    for index in 1...12 { Text("Row \(index)") }
                }.tabItem { Text("Second") }.tag(20)
            }
        }.padding()
    }
}
