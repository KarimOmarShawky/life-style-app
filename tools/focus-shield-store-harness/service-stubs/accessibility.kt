package android.accessibilityservice
import android.content.Context
import android.view.accessibility.AccessibilityEvent
open class AccessibilityService:Context() {
 open fun onServiceConnected() {}
 open fun onAccessibilityEvent(event:AccessibilityEvent?) {}
 open fun onInterrupt() {}
 open fun onDestroy() {}
 fun performGlobalAction(action:Int)=true
 companion object { const val GLOBAL_ACTION_HOME=1 }
}
