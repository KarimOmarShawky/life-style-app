import android.content.Context
import com.example.lifestyle_mobile.FocusShieldSessionStore
import com.example.lifestyle_mobile.FocusShieldAccessibilityService
fun expectFailure(f:()->Unit) { var failed=false; try { f() } catch (_:IllegalStateException) { failed=true }; check(failed) }
fun main() {
 val end=System.currentTimeMillis()+60000
 run {
  val ctx=Context(); val s=FocusShieldSessionStore(ctx); ctx.store.commitResults.add(false); ctx.store.commitResults.add(true)
  expectFailure { s.start("s","Study",end,setOf("social")) }
  check(!s.current().active); check(ctx.alarm.scheduled==0)
 }
 run {
  val ctx=Context(); val s=FocusShieldSessionStore(ctx); ctx.store.commitResults.add(false); ctx.store.commitResults.add(false)
  expectFailure { s.start("s","Study",end,setOf("social")) }
  check(!s.current().active); check(ctx.alarm.scheduled==0)
 }
 run {
  val ctx=Context(); val s=FocusShieldSessionStore(ctx); s.start("s","Study",end,setOf("social"))
  ctx.store.commitResults.add(false); ctx.store.commitResults.add(true)
  expectFailure { s.grantTemporaryBypass("social") }
  check(s.current().tempBypassPackage==null); check(FocusShieldAccessibilityService.scheduled==0)
  check(s.snapshot()["manualBypassesCount"]==0)
 }
 run {
  val ctx=Context(); val s=FocusShieldSessionStore(ctx); s.start("s","Study",end,setOf("social"))
  ctx.store.commitResults.add(false)
  expectFailure { s.stop() }
  check(!s.current().active); check(ctx.alarm.cancelled==1); check(ctx.notifications.cancelled==1)
 }
 println("4 FocusShieldSessionStore commit-failure checks passed with Android stubs")
}
