import UIKit
import Capacitor

// Da iOS 27 Apple chiude all'avvio le app senza ciclo di vita a scene
// (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). La scena
// carica lo stesso Main.storyboard (CAPBridgeViewController) di prima e
// passa a Capacitor i link aperti, come faceva l'AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let attivita = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: attivita, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for contesto in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: contesto.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
