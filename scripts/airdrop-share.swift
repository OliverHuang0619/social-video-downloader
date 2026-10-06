import Cocoa

final class AirDropApp: NSObject, NSApplicationDelegate, NSSharingServiceDelegate {
    let urls: [URL]
    init(urls: [URL]) { self.urls = urls }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let service = NSSharingService(named: .sendViaAirDrop) else {
            fputs("这台 Mac 不能使用 AirDrop\n", stderr)
            exit(1)
        }
        service.delegate = self
        NSApp.activate(ignoringOtherApps: true)
        service.perform(withItems: urls)
    }

    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        NSApp.terminate(nil)
    }

    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        let nsError = error as NSError
        if !(nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError) {
            fputs("\(nsError.localizedDescription)\n", stderr)
        }
        NSApp.terminate(nil)
    }
}

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
    fputs("没有要分享的文件\n", stderr)
    exit(1)
}

let appDelegate = AirDropApp(urls: paths.map { URL(fileURLWithPath: $0) })
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.delegate = appDelegate
app.run()
