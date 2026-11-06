package android.content
import android.content.pm.PackageManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.view.inputmethod.InputMethodManager
import android.telecom.TelecomManager
open class Context {
 companion object { const val MODE_PRIVATE=0; const val ALARM_SERVICE="alarm"; const val NOTIFICATION_SERVICE="notification"; const val INPUT_METHOD_SERVICE="input"; const val TELECOM_SERVICE="telecom" }
 val applicationContext: Context get()=this
 val packageName="com.lifestyle.app"
 val packageManager=PackageManager()
 val contentResolver=Any()
 val store=SharedPreferences()
 val alarm=AlarmManager()
 val notifications=NotificationManager()
 fun getSharedPreferences(name:String, mode:Int)=store
 fun getSystemService(name:String): Any = when(name) { ALARM_SERVICE->alarm; NOTIFICATION_SERVICE->notifications; INPUT_METHOD_SERVICE->InputMethodManager(); else->TelecomManager() }
 fun checkSelfPermission(permission:String)=PackageManager.PERMISSION_GRANTED
 fun sendBroadcast(intent:Intent) {}
 fun startActivity(intent:Intent) {}
}
class SharedPreferences {
 val data=mutableMapOf<String,Any>(); val commitResults=ArrayDeque<Boolean>()
 fun getBoolean(key:String, value:Boolean) = data[key] as? Boolean ?: value
 fun getLong(key:String, value:Long) = data[key] as? Long ?: value
 fun getInt(key:String, value:Int) = data[key] as? Int ?: value
 fun getString(key:String, value:String?) = data[key] as? String ?: value
 @Suppress("UNCHECKED_CAST") fun getStringSet(key:String,value:Set<String>)=data[key] as? Set<String> ?: value
 fun contains(key:String)=data.containsKey(key)
 fun edit()=Editor(this)
 class Editor(val prefs:SharedPreferences) {
  val updates=mutableMapOf<String,Any?>()
  fun putBoolean(k:String,v:Boolean)=apply{updates[k]=v}; fun putString(k:String,v:String?)=apply{updates[k]=v}
  fun putLong(k:String,v:Long)=apply{updates[k]=v}; fun putInt(k:String,v:Int)=apply{updates[k]=v}
  fun putStringSet(k:String,v:Set<String>)=apply{updates[k]=v}; fun remove(k:String)=apply{updates[k]=null}
  fun commit():Boolean { for ((k,v) in updates) if(v==null)prefs.data.remove(k) else prefs.data[k]=v; return if(prefs.commitResults.isEmpty()) true else prefs.commitResults.removeFirst() }
 }
}
class Intent {
 constructor(action:String)
 constructor(context:Context, cls:Class<*>)
 fun putExtra(name:String, value:String)=this
 fun setAction(action:String)=this
 fun addCategory(category:String)=this
 fun setData(uri:android.net.Uri)=this
 fun addFlags(flags:Int)=this
 companion object { const val ACTION_MAIN="main"; const val CATEGORY_HOME="home"; const val ACTION_VIEW="view"; const val FLAG_ACTIVITY_NEW_TASK=1; const val FLAG_ACTIVITY_SINGLE_TOP=2; const val FLAG_ACTIVITY_CLEAR_TOP=4 }
}
