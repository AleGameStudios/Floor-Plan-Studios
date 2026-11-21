// Camera lens for the 3D view.
// - Straight verticals: looking up or down shifts the lens instead of tilting the camera (two-point
//   perspective, as Enscape, Twinmotion and D5 do), so walls never lean in.
// - Wide lens: a Panini projection (as Unity and Unreal use for wide fields of view) shows a much wider
//   view than a normal lens without stretching the edges.
// Corner and contact shading is built into the model (view3d.js), not computed on screen, so it can't
// break into lines on surfaces seen at an angle.
window.FP = window.FP || {};

FP.post3d = function (T, renderer) {
  const qScene = new T.Scene(), qCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2));
  qScene.add(quad);
  let rt = null, broken = false;

  // Maps each screen pixel to a view direction (Panini or plain) and samples the scene there.
  quad.material = new T.ShaderMaterial({
    uniforms: { tColor: { value: null }, xmax: { value: 1 }, ymax: { value: 1 }, sy: { value: 0 }, Xr: { value: 1 }, Yt: { value: 1 }, Yb: { value: -1 }, panini: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tColor;
      uniform float xmax, ymax, sy, Xr, Yt, Yb, panini;
      void main() {
        float x = (vUv.x * 2.0 - 1.0) * xmax, y = (vUv.y * 2.0 - 1.0) * ymax + sy;
        // inverse Panini with distance d (0 = plain lens, 1 = full Panini), as in Unity's HDRP
        float d = panini, vd = 1.0 + d, hyp = x * x + vd * vd, D = x * d;
        float cd = (-D * x + vd * sqrt(hyp - D * D)) / hyp + d;
        vec2 R = vec2(x, y) * (cd / vd) / (cd - d);
        gl_FragColor = vec4(texture2D(tColor, vec2((R.x + Xr) / (2.0 * Xr), (R.y - Yb) / (Yt - Yb))).rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });

  // spec: { hfov (deg, horizontal), shift (tan of the lens shift up), panini (Panini distance, 0 = plain lens), pass (render through the lens pass even when plain) }
  function render(scene, cam, spec) {
    const cv = renderer.domElement, W = cv.width, H = cv.height, aspect = W / H;
    const half = (spec.hfov * Math.PI) / 360, c = Math.cos(half);
    const d = broken ? 0 : spec.panini || 0;
    const xmax = ((d + 1) * Math.sin(half)) / (d + c);
    const Xr = Math.tan(half), ymax = xmax / aspect, sy = spec.shift || 0;
    const k = (d + c) / ((d + 1) * c);
    const yt = ymax + sy, yb = -ymax + sy;
    const Yt = yt > 0 ? yt * k : yt, Yb = yb < 0 ? yb * k : yb;
    const n = cam.near;
    cam.projectionMatrix.makePerspective(-Xr * n, Xr * n, Yt * n, Yb * n, n, cam.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    if (!d && !spec.pass) { renderer.setRenderTarget(null); renderer.render(scene, cam); return; }

    // Source image: same pixel density as the screen at its centre, capped for very wide lenses.
    const dens = W / (2 * xmax);
    let sw = 2 * Xr * dens, sh = (Yt - Yb) * dens;
    const cap = Math.min(1, 4096 / Math.max(sw, sh), Math.sqrt(6e6 / (sw * sh)));
    sw = Math.max(16, Math.round(sw * cap)); sh = Math.max(16, Math.round(sh * cap));
    try {
      if (!rt || rt.width !== sw || rt.height !== sh) {
        if (rt) rt.dispose();
        rt = new T.WebGLRenderTarget(sw, sh, { type: T.HalfFloatType, samples: 4 });
        // the lens shrinks the picture toward the edges: mipmaps keep fine detail from aliasing there
        rt.texture.generateMipmaps = true;
        rt.texture.minFilter = T.LinearMipmapLinearFilter;
      }
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      const u = quad.material.uniforms;
      u.tColor.value = rt.texture;
      u.xmax.value = xmax; u.ymax.value = ymax; u.sy.value = sy; u.Xr.value = Xr; u.Yt.value = Yt; u.Yb.value = Yb; u.panini.value = d;
      renderer.setRenderTarget(null);
      renderer.render(qScene, qCam);
    } catch (e) {
      // GPU without float render targets: fall back to the plain lens for the rest of the session.
      broken = true;
      console.warn('Wide lens disabled:', e);
      renderer.setRenderTarget(null);
      render(scene, cam, spec);
    }
  }

  function dispose() { if (rt) rt.dispose(); rt = null; }
  return { render, dispose };
};
