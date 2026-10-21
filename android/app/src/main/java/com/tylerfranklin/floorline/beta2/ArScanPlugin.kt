package com.tylerfranklin.floorline.beta2

import android.Manifest
import android.graphics.Color
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.view.ViewGroup
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.IdentityHashMap
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * Floorline Beta 2: continuous ARCore scan.
 *
 * Runs an ARCore Session (motion tracking + horizontal/vertical plane detection,
 * depth when the device supports it), renders the camera image into a
 * GLSurfaceView placed *behind* a transparent WebView, and streams ~10 Hz
 * "frame" events to JS with the camera pose and every tracked plane's world
 * boundary polygon. All room-building logic lives in the web layer.
 */
@CapacitorPlugin(
    name = "ArScan",
    permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])],
)
class ArScanPlugin : Plugin() {
    private var session: Session? = null
    private var glView: GLSurfaceView? = null
    private var renderer: ScanRenderer? = null
    private var depthEnabled = false
    private var userRequestedInstall = true

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val a = ArCoreApk.getInstance().checkAvailability(context)
        val ret = JSObject()
        ret.put("status", a.name)
        ret.put("supported", a.isSupported)
        ret.put("installed", a == ArCoreApk.Availability.SUPPORTED_INSTALLED)
        call.resolve(ret)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermsCallback")
            return
        }
        activity.runOnUiThread { startOnUi(call) }
    }

    @PermissionCallback
    private fun cameraPermsCallback(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            activity.runOnUiThread { startOnUi(call) }
        } else {
            call.reject("Camera permission is required for the AR scan", "PERMISSION_DENIED")
        }
    }

    private fun startOnUi(call: PluginCall) {
        try {
            if (session != null) {
                call.resolve(JSObject().put("depth", depthEnabled))
                return
            }
            when (ArCoreApk.getInstance().requestInstall(activity, userRequestedInstall)) {
                ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                    userRequestedInstall = false
                    call.reject("Installing Google Play Services for AR — tap Start again when it finishes", "INSTALLING")
                    return
                }
                else -> {}
            }
            val s = Session(context)
            val cfg = Config(s)
            cfg.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
            cfg.updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
            cfg.focusMode = Config.FocusMode.AUTO
            cfg.lightEstimationMode = Config.LightEstimationMode.DISABLED
            depthEnabled = s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
            cfg.depthMode = if (depthEnabled) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
            s.configure(cfg)
            s.resume()
            session = s

            val r = ScanRenderer(s)
            renderer = r
            val v = GLSurfaceView(context)
            v.preserveEGLContextOnPause = true
            v.setEGLContextClientVersion(2)
            v.setEGLConfigChooser(8, 8, 8, 8, 16, 0)
            v.setRenderer(r)
            v.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            glView = v
            val web = bridge.webView
            val parent = web.parent as ViewGroup
            parent.addView(v, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            web.setBackgroundColor(Color.TRANSPARENT)
            call.resolve(JSObject().put("depth", depthEnabled))
        } catch (e: Exception) {
            teardown()
            call.reject("ARCore could not start: ${e.javaClass.simpleName}: ${e.message}", "AR_UNAVAILABLE", e)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity.runOnUiThread {
            teardown()
            call.resolve()
        }
    }

    private fun teardown() {
        renderer?.stopped = true
        glView?.let { v ->
            v.onPause()
            (v.parent as? ViewGroup)?.removeView(v)
        }
        glView = null
        renderer = null
        session?.let {
            try { it.pause() } catch (_: Exception) {}
            try { it.close() } catch (_: Exception) {}
        }
        session = null
        bridge?.webView?.setBackgroundColor(Color.WHITE)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        // GL thread first (onPause blocks until it stops calling session.update()).
        glView?.onPause()
        try { session?.pause() } catch (_: Exception) {}
    }

    override fun handleOnResume() {
        super.handleOnResume()
        val s = session ?: return
        try {
            s.resume()
        } catch (e: Exception) {
            // e.g. CameraNotAvailableException when another app grabbed the camera:
            // tell JS instead of silently showing a frozen/black background.
            val err = JSObject()
            err.put("tracking", "STOPPED")
            err.put("failure", "CAMERA_UNAVAILABLE")
            err.put("planes", JSArray())
            emit(err)
        }
        // Always restart the GL view, otherwise a failed resume left it paused forever.
        glView?.onResume()
    }

    override fun handleOnDestroy() {
        teardown()
        super.handleOnDestroy()
    }

    private fun emit(data: JSObject) {
        activity?.runOnUiThread { notifyListeners("frame", data) }
    }

    /** GL renderer: draws the camera background and samples ARCore state. */
    private inner class ScanRenderer(private val session: Session) : GLSurfaceView.Renderer {
        @Volatile var stopped = false
        private var tex = 0
        private var program = 0
        private val quad: FloatBuffer = floatBuf(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
        private val uv: FloatBuffer = floatBuf(FloatArray(8))
        private var lastEmit = 0L
        private val ids = IdentityHashMap<Plane, Int>()
        private var nextId = 1

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            val t = IntArray(1)
            GLES20.glGenTextures(1, t, 0)
            tex = t[0]
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            session.setCameraTextureName(tex)
            program = buildProgram(
                "attribute vec4 a_Pos; attribute vec2 a_Uv; varying vec2 v_Uv;" +
                    "void main(){ gl_Position = a_Pos; v_Uv = a_Uv; }",
                "#extension GL_OES_EGL_image_external : require\n" +
                    "precision mediump float; varying vec2 v_Uv; uniform samplerExternalOES u_Tex;" +
                    "void main(){ gl_FragColor = texture2D(u_Tex, v_Uv); }",
            )
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            GLES20.glViewport(0, 0, width, height)
            @Suppress("DEPRECATION")
            val rot = activity.windowManager.defaultDisplay.rotation
            session.setDisplayGeometry(rot, width, height)
        }

        override fun onDrawFrame(gl: GL10?) {
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
            if (stopped) return
            val frame: Frame = try { session.update() } catch (e: Exception) { return }
            if (frame.hasDisplayGeometryChanged()) {
                quad.position(0); uv.position(0)
                frame.transformCoordinates2d(
                    Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad,
                    Coordinates2d.TEXTURE_NORMALIZED, uv,
                )
            }
            if (frame.timestamp != 0L) drawBackground()
            val now = System.currentTimeMillis()
            if (now - lastEmit >= 100) {
                lastEmit = now
                try { emit(snapshot(frame)) } catch (_: Exception) {}
            }
        }

        private fun drawBackground() {
            GLES20.glDisable(GLES20.GL_DEPTH_TEST)
            GLES20.glDepthMask(false)
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
            val pos = GLES20.glGetAttribLocation(program, "a_Pos")
            val uvl = GLES20.glGetAttribLocation(program, "a_Uv")
            quad.position(0); uv.position(0)
            GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
            GLES20.glVertexAttribPointer(uvl, 2, GLES20.GL_FLOAT, false, 0, uv)
            GLES20.glEnableVertexAttribArray(pos)
            GLES20.glEnableVertexAttribArray(uvl)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(pos)
            GLES20.glDisableVertexAttribArray(uvl)
            GLES20.glDepthMask(true)
            GLES20.glEnable(GLES20.GL_DEPTH_TEST)
        }

        private fun snapshot(frame: Frame): JSObject {
            val cam = frame.camera
            val out = JSObject()
            out.put("t", frame.timestamp / 1_000_000)
            out.put("tracking", cam.trackingState.name)
            if (cam.trackingState != TrackingState.TRACKING) out.put("failure", cam.trackingFailureReason.name)
            out.put("depth", depthEnabled)
            val p = cam.pose
            val fwd = p.zAxis // camera looks down -Z
            out.put("pose", JSObject().apply {
                put("x", p.tx().toDouble()); put("y", p.ty().toDouble()); put("z", p.tz().toDouble())
                put("fx", -fwd[0].toDouble()); put("fy", -fwd[1].toDouble()); put("fz", -fwd[2].toDouble())
            })
            val planes = JSArray()
            for (pl in session.getAllTrackables(Plane::class.java)) {
                if (pl.trackingState != TrackingState.TRACKING || pl.subsumedBy != null) continue
                val c = pl.centerPose
                val n = c.yAxis
                val poly = pl.polygon
                val pts = JSArray()
                poly.rewind()
                val local = FloatArray(3)
                while (poly.remaining() >= 2) {
                    local[0] = poly.get(); local[1] = 0f; local[2] = poly.get()
                    val w = c.transformPoint(local)
                    pts.put(JSArray().apply { put(w[0].toDouble()); put(w[1].toDouble()); put(w[2].toDouble()) })
                }
                val id = ids.getOrPut(pl) { nextId++ }
                planes.put(JSObject().apply {
                    put("id", id)
                    put("type", pl.type.name)
                    put("cx", c.tx().toDouble()); put("cy", c.ty().toDouble()); put("cz", c.tz().toDouble())
                    put("nx", n[0].toDouble()); put("ny", n[1].toDouble()); put("nz", n[2].toDouble())
                    put("ex", pl.extentX.toDouble()); put("ez", pl.extentZ.toDouble())
                    put("polygon", pts)
                })
            }
            out.put("planes", planes)
            return out
        }
    }

    companion object {
        fun floatBuf(a: FloatArray): FloatBuffer =
            ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }

        fun buildProgram(vs: String, fs: String): Int {
            fun sh(type: Int, src: String): Int {
                val s = GLES20.glCreateShader(type)
                GLES20.glShaderSource(s, src)
                GLES20.glCompileShader(s)
                return s
            }
            val p = GLES20.glCreateProgram()
            GLES20.glAttachShader(p, sh(GLES20.GL_VERTEX_SHADER, vs))
            GLES20.glAttachShader(p, sh(GLES20.GL_FRAGMENT_SHADER, fs))
            GLES20.glLinkProgram(p)
            return p
        }
    }
}
