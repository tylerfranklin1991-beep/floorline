/**
 * WebXR (ARCore on Android Chrome) corner capture.
 *
 * We start an immersive-ar session with hit-testing against detected floor
 * planes. The camera image is composited by the browser; we render nothing in
 * 3D. A DOM overlay shows a crosshair at screen centre, and every frame we
 * hit-test a ray from the centre of the view. "Mark corner" stores the current
 * floor hit (x, z in metres). Those raw points are cleaned with
 * `rectilinearize` afterwards.
 */

export type ArPoint = { x: number; z: number };

export type ArSessionHandle = {
  end: () => void;
  /** Latest floor point under the crosshair, or null if no surface yet. */
  current: () => ArPoint | null;
};

export async function isArSupported(): Promise<boolean> {
  const xr = (navigator as any).xr;
  if (!xr?.isSessionSupported) return false;
  try {
    return Boolean(await xr.isSessionSupported("immersive-ar"));
  } catch {
    return false;
  }
}

export async function startArSession(opts: {
  overlay: HTMLElement;
  onHit: (p: ArPoint | null) => void;
  onEnd: () => void;
}): Promise<ArSessionHandle> {
  const xr = (navigator as any).xr;
  const session: any = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test", "local-floor"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: opts.overlay },
  });
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { xrCompatible: true, alpha: true }) as any;
  if (!gl) {
    await session.end();
    throw new Error("WebGL unavailable");
  }
  if (gl.makeXRCompatible) await gl.makeXRCompatible();
  const XRWebGLLayer = (window as any).XRWebGLLayer;
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { alpha: true }) });
  const refSpace = await session.requestReferenceSpace("local-floor");
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });
  let latest: ArPoint | null = null;
  let ended = false;

  const onFrame = (_t: number, frame: any) => {
    if (ended) return;
    session.requestAnimationFrame(onFrame);
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const hits = frame.getHitTestResults(hitSource);
    const pose = hits[0]?.getPose(refSpace);
    latest = pose ? { x: pose.transform.position.x, z: pose.transform.position.z } : null;
    opts.onHit(latest);
  };
  session.requestAnimationFrame(onFrame);
  session.addEventListener("end", () => {
    ended = true;
    try {
      hitSource.cancel();
    } catch {
      /* already gone */
    }
    opts.onEnd();
  });
  return {
    end: () => {
      if (!ended) void session.end();
    },
    current: () => latest,
  };
}

/** AR gives metres in x/z; plans use the property's units with +y down. */
export function arPointsToPlan(points: ArPoint[], units: "ft" | "m") {
  const f = units === "ft" ? 1 / 0.3048 : 1;
  return points.map((p) => ({ x: p.x * f, y: p.z * f }));
}
