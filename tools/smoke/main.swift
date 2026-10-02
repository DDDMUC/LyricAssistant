import Cocoa
import WebKit

// 真浏览器（WKWebView，Tauri 同款引擎）冒烟测试：
//   swiftc -O tools/smoke/main.swift -o /tmp/cige-smoke && /tmp/cige-smoke tools/smoke/scenarios http://localhost:1420
// 每个场景是一个 .js 文件，内容为 async 函数体，最后 return { ok, detail }

let args = CommandLine.arguments
let scenarioDir = args.count > 1 ? args[1] : "tools/smoke/scenarios"
let pageURL = args.count > 2 ? args[2] : "http://localhost:1420"

struct Scenario {
  let name: String
  let body: String
}

let files = (try? FileManager.default.contentsOfDirectory(atPath: scenarioDir))?
  .filter { $0.hasSuffix(".js") }
  .sorted() ?? []
guard !files.isEmpty else {
  print("没有场景文件：\(scenarioDir)")
  exit(2)
}
let scenarios = files.map { name in
  Scenario(name: name, body: (try? String(contentsOfFile: "\(scenarioDir)/\(name)", encoding: .utf8)) ?? "")
}

let app = NSApplication.shared

final class Driver: NSObject, WKNavigationDelegate {
  var webView: WKWebView!
  var index = 0
  var failures = 0
  let total = scenarios.count
  var pending: Scenario? = nil
  var booted = false

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    print("✗ 页面加载失败：\(error.localizedDescription)")
    exit(2)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    print("✗ 页面加载失败（\(pageURL)）：\(error.localizedDescription)")
    exit(2)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let scenario = pending {
      pending = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.evaluate(scenario) }
      return
    }
    guard !booted else { return }
    booted = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.runNext() }
  }

  func runNext() {
    if index >= total {
      print("——————")
      print(failures == 0 ? "✅ 冒烟测试全部通过（\(total) 个场景）" : "❌ \(failures)/\(total) 个场景失败")
      exit(failures == 0 ? 0 : 1)
    }
    let scenario = scenarios[index]
    if index == 0 {
      evaluate(scenario)
      return
    }
    // 每个场景前刷新一次页面：干净起步，场景之间不互相污染
    pending = scenario
    webView.reload()
  }

  func evaluate(_ scenario: Scenario) {
    webView.callAsyncJavaScript(scenario.body, arguments: [:], in: nil, in: .page) { [self] result in
      DispatchQueue.main.async {
        switch result {
        case .success(let value):
          let dict = value as? [String: Any]
          let ok = (dict?["ok"] as? Bool) ?? ((dict?["ok"] as? NSNumber)?.boolValue ?? false)
          let detail = dict?["detail"] as? String ?? ""
          print("\(ok ? "✓" : "✗") \(scenario.name)\(detail.isEmpty ? "" : " — \(detail)")")
          if !ok { failures += 1 }
        case .failure(let error):
          print("✗ \(scenario.name) 执行失败：\(error.localizedDescription)")
          failures += 1
        }
        self.index += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.runNext() }
      }
    }
  }
}

let config = WKWebViewConfiguration()
// 桌面模式桩 + 报错收集 + 每次跑都从干净存储开始
let bootstrap = """
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
try { localStorage.clear(); } catch (e) {}
window.__TAURI_INTERNALS__ = {
  invoke: () => Promise.reject(new Error('smoke-stub')),
  transformCallback: (cb) => cb,
  metadata: {
    currentWebview: { label: 'main' },
    currentWindow: { label: location.search.indexOf('win=ai') >= 0 ? 'ai-doc-1' : (location.search.indexOf('win=docs') >= 0 ? 'docs' : 'main') },
  },
};
"""
config.userContentController.addUserScript(
  WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)
)

let window = NSWindow(
  contentRect: NSRect(x: -4000, y: 0, width: 1280, height: 900),
  styleMask: [.titled], backing: .buffered, defer: false
)
let webView = WKWebView(
  frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: config
)
window.contentView = webView
window.orderFrontRegardless()
let driver = Driver()
driver.webView = webView
webView.navigationDelegate = driver
webView.load(URLRequest(url: URL(string: pageURL)!))

// 看门狗：整场超时（默认 90 秒）就退出，绝不干等
let watchdogSeconds = Double(ProcessInfo.processInfo.environment["SMOKE_TIMEOUT"] ?? "90") ?? 90
Timer.scheduledTimer(withTimeInterval: watchdogSeconds, repeats: false) { _ in
  print("✗ 冒烟测试超时（\(Int(watchdogSeconds))s）")
  exit(2)
}
app.run()
