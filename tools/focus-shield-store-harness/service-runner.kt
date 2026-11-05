import com.example.lifestyle_mobile.FocusShieldAccessibilityService
import com.example.lifestyle_mobile.FocusShieldSessionStore
fun main() {
 val service=FocusShieldAccessibilityService(); service.onServiceConnected()
 val store=FocusShieldSessionStore(service); store.start("session", "Study", System.currentTimeMillis()+60000, setOf("social"))
 check(FocusShieldAccessibilityService.isConnected()); check(store.current().active)
 service.onDestroy()
 check(!FocusShieldAccessibilityService.isConnected()); check(!store.current().active)
 check(store.snapshot()["endReason"]=="accessibility_lost")
 println("Accessibility destruction stops active session in stubbed JVM harness")
}
