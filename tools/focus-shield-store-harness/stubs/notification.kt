package androidx.core.app
import android.content.Context
import android.app.PendingIntent
class NotificationCompat { class Builder(ctx:Context,id:String) { fun setSmallIcon(i:Int)=this; fun setContentTitle(s:String)=this; fun setContentText(s:String)=this; fun setOngoing(v:Boolean)=this; fun setContentIntent(i:PendingIntent)=this; fun setTimeoutAfter(t:Long)=this; fun addAction(i:Int,s:String,p:PendingIntent)=this; fun build()=Any() } }
