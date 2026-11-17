import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene { WindowGroup { CounterView() } }
}

struct CounterView: View {
    @State private var count = 0
    @State private var name = "Ada"
    @State private var enabled = true
    @State private var level = 0.5
    @State private var showSheet = false
    @State private var showAlert = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text("Local Swift Runtime").font(.title)
                    Text("Count: \(count)").font(.largeTitle)
                    HStack {
                        Button("Decrease") { count -= enabled ? 1 : 0 }
                        Button("Increase") { count += enabled ? 1 : 0 }
                    }
                    TextField("Your name", text: $name)
                    Text("Hello, \(name)!")
                    Toggle("Counter enabled", isOn: $enabled)
                    Slider(value: $level, in: 0...1)
                    Text("Level: \(Int(level * 100))")
                    NavigationLink("Open details") {
                        VStack {
                            Text("Details").font(.title)
                            Text("Navigation executed by Swift")
                        }.padding()
                    }
                    Button("Show sheet") { showSheet = true }
                    Button("Show alert") { showAlert = true }
                }.padding(24)
            }.navigationTitle("Counter")
        }
        .sheet(isPresented: $showSheet) { Text("Sheet from Swift state").padding() }
        .alert("Swift alert", isPresented: $showAlert) { Text("The callback changed application state.") }
    }
}
