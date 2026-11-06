package android.os
object Build { object VERSION { const val SDK_INT=30 } }
object SystemClock { fun elapsedRealtime():Long = 1000 }
class Looper { companion object { fun getMainLooper()=Looper() } }
class Handler(looper:Looper) { fun removeCallbacksAndMessages(x:Any?){}; fun postDelayed(f:()->Unit,ms:Long)=true }
