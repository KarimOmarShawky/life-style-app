package android.app
import android.content.Context
import android.content.Intent
class AlarmManager { var cancelled=0; var scheduled=0; fun cancel(i:PendingIntent){cancelled++}; fun canScheduleExactAlarms()=true; fun setExactAndAllowWhileIdle(type:Int,end:Long,i:PendingIntent){scheduled++}; fun setAndAllowWhileIdle(type:Int,end:Long,i:PendingIntent){scheduled++}; companion object {const val RTC_WAKEUP=0} }
class NotificationManager { var cancelled=0; fun cancel(id:Int){cancelled++}; fun createNotificationChannel(channel:NotificationChannel) {}; fun notify(id:Int,item:Any) {}; companion object {const val IMPORTANCE_LOW=1} }
class NotificationChannel(id:String,name:String,importance:Int)
class PendingIntent { companion object {const val FLAG_UPDATE_CURRENT=1; const val FLAG_IMMUTABLE=2; fun getBroadcast(ctx:Context,id:Int,i:Intent,flags:Int)=PendingIntent(); fun getActivity(ctx:Context,id:Int,i:Intent,flags:Int)=PendingIntent()} }
