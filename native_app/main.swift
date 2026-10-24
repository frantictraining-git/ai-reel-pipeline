import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?
    var downloadDestinationURL: URL?

    func setupMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Close Swift Reel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // File menu
        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New Job", action: #selector(menuNewJob), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Open Job…", action: #selector(menuOpenJob), keyEquivalent: "o")
        fileMenu.addItem(withTitle: "Save Job…", action: #selector(menuSaveJob), keyEquivalent: "s")
        fileMenu.addItem(withTitle: "Close Job", action: #selector(menuCloseJob), keyEquivalent: "w")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "Close Swift Reel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        fileItem.submenu = fileMenu

        // Edit menu (enables Cmd+A / C / V / X / Z in web view and file pickers)
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        // View menu (Cmd+R reload)
        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        viewItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    @objc func reloadPage() {
        webView.reload()
    }

    @objc func menuNewJob() {
        webView.evaluateJavaScript("window.swiftReelFileAction && window.swiftReelFileAction('new')", completionHandler: nil)
    }

    @objc func menuOpenJob() {
        webView.evaluateJavaScript("window.swiftReelFileAction && window.swiftReelFileAction('open')", completionHandler: nil)
    }

    @objc func menuSaveJob() {
        webView.evaluateJavaScript("window.swiftReelFileAction && window.swiftReelFileAction('save')", completionHandler: nil)
    }

    @objc func menuCloseJob() {
        webView.evaluateJavaScript("window.swiftReelFileAction && window.swiftReelFileAction('close')", completionHandler: nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenu()
        startServer()

        let windowRect = NSRect(x: 100, y: 100, width: 1400, height: 920)
        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "Swift Reel"
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView?.addSubview(webView)

        loadWhenReady()

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Handle HTML <input type="file"> click open panel
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        // Always allow selecting multiple files so users can Cmd+Click / Shift+Click as many clips as they want
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: self.window) { response in
            if response == .OK {
                completionHandler(panel.urls)
            } else {
                completionHandler(nil)
            }
        }
    }

    // Handle file downloads in native WKWebView
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
        } else {
            decisionHandler(.allow, preferences)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let httpResp = navigationResponse.response as? HTTPURLResponse,
           let disp = httpResp.value(forHTTPHeaderField: "Content-Disposition"),
           disp.lowercased().contains("attachment") {
            decisionHandler(.download)
            return
        }
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        var destURL = downloadsDir.appendingPathComponent(suggestedFilename)
        var counter = 1
        let ext = destURL.pathExtension
        let base = destURL.deletingPathExtension().lastPathComponent
        while FileManager.default.fileExists(atPath: destURL.path) {
            let newName = ext.isEmpty ? "\(base)-\(counter)" : "\(base)-\(counter).\(ext)"
            destURL = downloadsDir.appendingPathComponent(newName)
            counter += 1
        }
        self.downloadDestinationURL = destURL
        completionHandler(destURL)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let dest = self.downloadDestinationURL {
            NSWorkspace.shared.activateFileViewerSelecting([dest])
        }
    }

    // Handle JavaScript alert() panels inside native WKWebView
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Swift Reel"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: self.window) { _ in
            completionHandler()
        }
    }

    // Handle JavaScript confirm() panels
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Swift Reel"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: self.window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func startServer() {
        let check = checkServer()
        if !check {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            task.currentDirectoryURL = URL(fileURLWithPath: "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline")
            task.arguments = ["app.py"]
            
            let logURL = URL(fileURLWithPath: "/tmp/reel_pipeline.log")
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            if let fileHandle = try? FileHandle(forWritingTo: logURL) {
                fileHandle.seekToEndOfFile()
                task.standardOutput = fileHandle
                task.standardError = fileHandle
            }
            
            try? task.run()
            self.serverProcess = task
        }
    }

    func checkServer() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:5050") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        let semaphore = DispatchSemaphore(value: 0)
        var ok = false
        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                ok = true
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 0.6)
        return ok
    }

    func loadWhenReady(attempt: Int = 0) {
        if checkServer() {
            DispatchQueue.main.async {
                if let url = URL(string: "http://127.0.0.1:5050") {
                    self.webView.load(URLRequest(url: url))
                }
            }
        } else if attempt < 30 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self.loadWhenReady(attempt: attempt + 1)
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let proc = serverProcess, proc.isRunning {
            proc.terminate()
        }
        let killTask = Process()
        killTask.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        killTask.arguments = ["-f", "app.py"]
        try? killTask.run()
        killTask.waitUntilExit()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
