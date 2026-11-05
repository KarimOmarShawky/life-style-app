package android.content.pm
import android.content.Intent
class PackageManager { fun resolveActivity(i:Intent,f:Int): ResolveInfo? = null; companion object { const val MATCH_DEFAULT_ONLY=1; const val PERMISSION_GRANTED=0 } }
class ResolveInfo { val activityInfo=ActivityInfo() }
class ActivityInfo { val packageName="home" }
