// Independently implemented source compatibility subset. No Apple framework code.
import Foundation

public struct Node: Codable {
    public var kind: String
    public var id: String = ""
    public var props: [String: String] = [:]
    public var children: [Node] = []
}

public protocol View {
    associatedtype Body: View
    @ViewBuilder var body: Body { get }
    func _render(_ path: String) -> Node
}
extension View {
    public func _render(_ path: String) -> Node { body._render(path) }
}
public struct NeverView: View {
    public var body: NeverView { return NeverView() }
    public func _render(_ path: String) -> Node { Node(kind: "empty", id: path) }
}
public protocol PrimitiveView: View where Body == NeverView {}
extension PrimitiveView { public var body: NeverView { return NeverView() } }

public struct AnyView: PrimitiveView {
    let render: (String) -> Node
    public init<V: View>(_ view: V) { render = view._render }
    public func _render(_ path: String) -> Node { render(path) }
}
public struct ViewGroup: PrimitiveView {
    let views: [AnyView]
    public func _render(_ path: String) -> Node {
        Node(kind: "group", id: path, children: views.enumerated().map { $0.element._render("\(path).\($0.offset)") })
    }
}
@resultBuilder public enum ViewBuilder {
    public static func buildExpression<V: View>(_ view: V) -> AnyView { AnyView(view) }
    public static func buildBlock(_ views: AnyView...) -> ViewGroup { ViewGroup(views: views) }
    public static func buildOptional(_ view: ViewGroup?) -> AnyView { AnyView(view ?? ViewGroup(views: [])) }
    public static func buildEither(first: ViewGroup) -> AnyView { AnyView(first) }
    public static func buildEither(second: ViewGroup) -> AnyView { AnyView(second) }
    public static func buildArray(_ views: [ViewGroup]) -> AnyView { AnyView(ViewGroup(views: views.map(AnyView.init))) }
}

private final class Box<Value> { var value: Value; init(_ value: Value) { self.value = value } }
@propertyWrapper public struct State<Value> {
    private let box: Box<Value>
    public init(wrappedValue: Value) { box = Box(wrappedValue) }
    public var wrappedValue: Value {
        get { box.value }
        nonmutating set { box.value = newValue }
    }
    public var projectedValue: Binding<Value> {
        Binding(get: { box.value }, set: { box.value = $0 })
    }
}
@propertyWrapper public struct Binding<Value> {
    let get: () -> Value
    let set: (Value) -> Void
    public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) { self.get = get; self.set = set }
    public var wrappedValue: Value { get { get() } nonmutating set { set(newValue) } }
    public var projectedValue: Binding<Value> { self }
    public static func constant(_ value: Value) -> Binding<Value> { Binding(get: { value }, set: { _ in }) }
}

public struct Text: PrimitiveView {
    let text: String
    public init(_ text: String) { self.text = text }
    public func _render(_ path: String) -> Node { Node(kind: "text", id: path, props: ["text": text]) }
}
public struct Image: PrimitiveView {
    let name: String
    public init(systemName: String) { name = systemName }
    public func _render(_ path: String) -> Node { Node(kind: "symbol", id: path, props: ["text": name]) }
}
public struct Button: PrimitiveView {
    let label: AnyView
    let action: () -> Void
    public init(_ title: String, action: @escaping () -> Void) { label = AnyView(Text(title)); self.action = action }
    public init<Label: View>(action: @escaping () -> Void, @ViewBuilder label: () -> Label) { self.label = AnyView(label()); self.action = action }
    public func _render(_ path: String) -> Node {
        Runtime.actions[path] = { _ in action() }
        return Node(kind: "button", id: path, children: [label._render(path + ".label")])
    }
}
public struct Stack: PrimitiveView {
    let kind: String
    let content: AnyView
    let spacing: Double
    public func _render(_ path: String) -> Node {
        Node(kind: kind, id: path, props: ["spacing": String(spacing)], children: [content._render(path + ".content")])
    }
}
public func VStack<Content: View>(spacing: Double = 8, @ViewBuilder content: () -> Content) -> Stack { Stack(kind: "vstack", content: AnyView(content()), spacing: spacing) }
public func HStack<Content: View>(spacing: Double = 8, @ViewBuilder content: () -> Content) -> Stack { Stack(kind: "hstack", content: AnyView(content()), spacing: spacing) }
public func ZStack<Content: View>(@ViewBuilder content: () -> Content) -> Stack { Stack(kind: "zstack", content: AnyView(content()), spacing: 0) }
public func ScrollView<Content: View>(@ViewBuilder content: () -> Content) -> Stack { Stack(kind: "scroll", content: AnyView(content()), spacing: 0) }
public func List<Content: View>(@ViewBuilder content: () -> Content) -> Stack { Stack(kind: "list", content: AnyView(content()), spacing: 8) }
public struct Spacer: PrimitiveView {
    public init() {}
    public func _render(_ path: String) -> Node { Node(kind: "spacer", id: path) }
}
public struct ProgressView: PrimitiveView {
    let title: String
    public init(_ title: String = "") { self.title = title }
    public func _render(_ path: String) -> Node { Node(kind: "progress", id: path, props: ["text": title]) }
}
public struct TextField: PrimitiveView {
    let title: String
    let text: Binding<String>
    let secure: Bool
    public init(_ title: String, text: Binding<String>) { self.title = title; self.text = text; secure = false }
    init(_ title: String, text: Binding<String>, secure: Bool) { self.title = title; self.text = text; self.secure = secure }
    public func _render(_ path: String) -> Node {
        Runtime.actions[path] = { if let value = $0 as? String { text.wrappedValue = value } }
        return Node(kind: secure ? "securefield" : "textfield", id: path, props: ["text": title, "value": text.wrappedValue])
    }
}
public func SecureField(_ title: String, text: Binding<String>) -> TextField { TextField(title, text: text, secure: true) }
public struct Toggle: PrimitiveView {
    let title: String
    let value: Binding<Bool>
    public init(_ title: String, isOn: Binding<Bool>) { self.title = title; value = isOn }
    public func _render(_ path: String) -> Node {
        Runtime.actions[path] = { if let flag = $0 as? Bool { value.wrappedValue = flag } }
        return Node(kind: "toggle", id: path, props: ["text": title, "value": String(value.wrappedValue)])
    }
}
public struct Slider: PrimitiveView {
    let value: Binding<Double>
    let range: ClosedRange<Double>
    public init(value: Binding<Double>, in range: ClosedRange<Double> = 0...1) { self.value = value; self.range = range }
    public func _render(_ path: String) -> Node {
        Runtime.actions[path] = { if let number = $0 as? Double { value.wrappedValue = min(range.upperBound, max(range.lowerBound, number)) } }
        return Node(kind: "slider", id: path, props: ["value": String(value.wrappedValue), "min": String(range.lowerBound), "max": String(range.upperBound)])
    }
}

public struct NavigationStack: PrimitiveView {
    let content: AnyView
    public init<Content: View>(@ViewBuilder content: () -> Content) { self.content = AnyView(content()) }
    public func _render(_ path: String) -> Node {
        var children: [Node] = []
        if !Runtime.navigation.isEmpty {
            children.append(Button("Back") { _ = Runtime.navigation.popLast() }._render(path + ".back"))
        }
        children.append((Runtime.navigation.last ?? content)._render(path + ".page"))
        return Node(kind: "navigation", id: path, children: children)
    }
}
public struct NavigationLink: PrimitiveView {
    let title: String
    let destination: AnyView
    public init<Destination: View>(_ title: String, @ViewBuilder destination: () -> Destination) { self.title = title; self.destination = AnyView(destination()) }
    public init<Destination: View>(_ title: String, destination: Destination) { self.title = title; self.destination = AnyView(destination) }
    public func _render(_ path: String) -> Node {
        Button(title) { Runtime.navigation.append(destination) }._render(path)
    }
}
public struct TabView: PrimitiveView {
    let content: ViewGroup
    let selection: Binding<Int>?
    public init(@ViewBuilder content: () -> ViewGroup) { self.content = content(); selection = nil }
    public init(selection: Binding<Int>, @ViewBuilder content: () -> ViewGroup) { self.content = content(); self.selection = selection }
    public func _render(_ path: String) -> Node {
        let children = content.views.enumerated().map { index, view -> Node in
            var node = view._render("\(path).\(index)")
            func metadata(_ key: String, in node: Node) -> String? {
                node.props[key] ?? (node.kind == "modified" ? node.children.first.flatMap { metadata(key, in: $0) } : nil)
            }
            node.props["tag"] = metadata("tag", in: node) ?? String(index)
            node.props["tabTitle"] = metadata("tabTitle", in: node) ?? "Tab \(index + 1)"
            return node
        }
        let current = selection?.wrappedValue ?? Runtime.tabs[path] ?? Int(children.first?.props["tag"] ?? "0") ?? 0
        Runtime.actions[path] = { value in
            guard let tag = value as? Int, children.contains(where: { $0.props["tag"] == String(tag) }) else { return }
            if let selection { selection.wrappedValue = tag } else { Runtime.tabs[path] = tag }
        }
        return Node(kind: "tabs", id: path, props: ["selection": String(current)], children: children)
    }
}

public struct Color {
    let value: String
    public static let blue = Color(value: "#007aff"), red = Color(value: "#ff3b30"), green = Color(value: "#34c759"), white = Color(value: "#ffffff"), black = Color(value: "#000000"), gray = Color(value: "#8e8e93"), orange = Color(value: "#ff9500"), clear = Color(value: "transparent")
}
public struct Font {
    let value: String
    public static let largeTitle = Font(value: "34"), title = Font(value: "28"), title2 = Font(value: "22"), headline = Font(value: "17"), body = Font(value: "17"), caption = Font(value: "12")
    public static func system(size: Double) -> Font { Font(value: String(size)) }
}
private struct Modified: PrimitiveView {
    let content: AnyView
    let props: [String: String]
    func _render(_ path: String) -> Node {
        if props.keys.allSatisfy({ $0 == "tag" || $0 == "tabTitle" }) {
            var node = content._render(path + ".view")
            node.props.merge(props) { _, new in new }
            return node
        }
        return Node(kind: "modified", id: path, props: props, children: [content._render(path + ".view")])
    }
}
extension View {
    private func modified(_ props: [String: String]) -> some View { Modified(content: AnyView(self), props: props) }
    public func padding(_ value: Double = 16) -> some View { modified(["padding": String(value)]) }
    public func font(_ font: Font) -> some View { modified(["fontSize": font.value]) }
    public func foregroundStyle(_ color: Color) -> some View { modified(["color": color.value]) }
    public func foregroundColor(_ color: Color) -> some View { foregroundStyle(color) }
    public func background(_ color: Color) -> some View { modified(["background": color.value]) }
    public func cornerRadius(_ value: Double) -> some View { modified(["borderRadius": String(value)]) }
    public func opacity(_ value: Double) -> some View { modified(["opacity": String(value)]) }
    public func offset(x: Double = 0, y: Double = 0) -> some View { modified(["offsetX": String(x), "offsetY": String(y)]) }
    public func frame(width: Double? = nil, height: Double? = nil) -> some View {
        var props: [String: String] = [:]
        if let width { props["width"] = String(width) }
        if let height { props["height"] = String(height) }
        return modified(props)
    }
    public func navigationTitle(_ title: String) -> some View { modified(["title": title]) }
    public func tag(_ value: Int) -> some View { modified(["tag": String(value)]) }
    public func tabItem<Label: View>(@ViewBuilder _ label: () -> Label) -> some View {
        let node = label()._render("tab-label")
        func text(_ node: Node) -> String { (node.props["text"] ?? "") + node.children.map(text).joined() }
        return modified(["tabTitle": text(node)])
    }
    public func sheet<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        Presentation(content: AnyView(self), presented: isPresented, title: nil, overlay: { AnyView(content()) })
    }
    public func alert<Actions: View>(_ title: String, isPresented: Binding<Bool>, @ViewBuilder actions: @escaping () -> Actions) -> some View {
        Presentation(content: AnyView(self), presented: isPresented, title: title, overlay: { AnyView(actions()) })
    }
}
private struct Presentation: PrimitiveView {
    let content: AnyView
    let presented: Binding<Bool>
    let title: String?
    let overlay: () -> AnyView
    func _render(_ path: String) -> Node {
        var children = [content._render(path + ".base")]
        if presented.wrappedValue {
            let close = Button("Close") { presented.wrappedValue = false }
            children.append(Node(kind: title == nil ? "sheet" : "alert", id: path + ".overlay", props: ["text": title ?? ""], children: [overlay()._render(path + ".overlay.content"), close._render(path + ".close")]))
        }
        return Node(kind: "presentation", id: path, children: children)
    }
}

public protocol Scene { var _root: AnyView { get } }
public struct WindowGroup: Scene {
    public let _root: AnyView
    public init<Content: View>(@ViewBuilder content: () -> Content) { _root = AnyView(content()) }
}
public protocol App {
    associatedtype Body: Scene
    init()
    var body: Body { get }
}
extension App {
    public static func main() {
        let app = Self()
        let scene = app.body
        Runtime.run(scene._root)
    }
}
private enum Runtime {
    static var actions: [String: (Any?) -> Void] = [:]
    static var navigation: [AnyView] = []
    static var tabs: [String: Int] = [:]
    static func run(_ root: AnyView) {
        var revision = 0
        func render() {
            actions.removeAll(keepingCapacity: true)
            let tree = root._render("root")
            revision += 1
            let message = Frame(revision: revision, root: tree)
            if let data = try? JSONEncoder().encode(message) {
                FileHandle.standardOutput.write(Data("OIS:".utf8) + data + Data([10]))
            }
        }
        render()
        while let line = readLine() {
            guard let data = line.data(using: .utf8), let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = event["id"] as? String else { continue }
            if id == "__quit" { return }
            guard let action = actions[id] else { continue }
            action(event["value"])
            render()
        }
    }
    struct Frame: Encodable { let revision: Int; let root: Node }
}
