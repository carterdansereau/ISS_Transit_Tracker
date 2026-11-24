"use strict";

function setupHorizon() {
  const canvas = $("panorama"), ctx = canvas.getContext("2d");
  const guide = $("sky-guide"), trail = $("trail"), rad = Math.PI / 180;
  const compass = ["N","NE","E","SE","S","SW","W","NW"];
  let heading = 0, pitch = 22, samples = [], pathKey = "", pathStatus = "", drag;
  function face() {
    const body = positions.find(p => p.name === selected);
    if (body) { heading = body.az; pitch = Math.max(5,body.alt); }
  }
  function draw() {
    if (canvas.hidden || !canvas.clientWidth || !canvas.clientHeight) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w*ratio) || canvas.height !== Math.round(h*ratio)) {
      canvas.width = Math.round(w*ratio); canvas.height = Math.round(h*ratio);
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const focal = Math.min(w,h)*0.85, tilt = pitch*rad;
    function project(alt,az) {
      const a = alt*rad, d = (az-heading)*rad;
      const forward = Math.cos(a)*Math.cos(d), up = Math.sin(a);
      const depth = forward*Math.cos(tilt) + up*Math.sin(tilt);
      if (depth <= 0.03) return null;
      return [w/2 + focal*Math.cos(a)*Math.sin(d)/depth,
              h/2 - focal*(up*Math.cos(tilt)-forward*Math.sin(tilt))/depth];
    }
    const horizonY = h/2 + focal*Math.tan(tilt);
    const sky = ctx.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,"#0b1929"); sky.addColorStop(1,"#284951");
    ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = "#152724"; ctx.fillRect(0,horizonY,w,h);
    function line(points,color) {
      ctx.beginPath();
      let connected = false;
      for (const p of points) {
        const xy = p && p.alt >= 0 && project(p.alt,p.az);
        if (xy) { if (connected) ctx.lineTo(...xy); else ctx.moveTo(...xy); }
        connected = Boolean(xy);
      }
      ctx.strokeStyle = color; ctx.stroke();
    }
    for (let alt=0; alt<90; alt+=15)
      line(Array.from({length:121},(_,i)=>({alt,az:i*3})),alt ? "#35515d" : "#86b4aa");
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    for (let az=0; az<360; az+=45) {
      line(Array.from({length:31},(_,i)=>({alt:i*3,az})),"#35515d");
      const xy = project(0,az);
      if (xy) { ctx.fillStyle = "#d1e3dc"; ctx.fillText(compass[az/45],xy[0],xy[1]+16); }
    }
    ctx.setLineDash([5,5]); line(samples,"#ffc580"); ctx.setLineDash([]);
    ctx.textAlign = "left";
    for (const p of positions) {
      if (p.alt < 0) continue;
      const xy = project(p.alt,p.az);
      if (!xy) continue;
      const [x,y] = xy;
      ctx.fillStyle = isISS(p.name) ? "#ffc27b" : "#a4ddbf";
      ctx.beginPath(); ctx.arc(x,y,4,0,2*Math.PI); ctx.fill();
      if (p.name===selected) {
        ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.arc(x,y,8,0,2*Math.PI); ctx.stroke();
      }
      ctx.strokeStyle = "#152630"; ctx.lineWidth = 3; ctx.strokeText(p.name,x+11,y+4);
      ctx.lineWidth = 1; ctx.fillText(p.name,x+11,y+4);
    }
    const az = (heading%360+360)%360;
    document.querySelector(".chart-foot span:last-child").textContent =
      compass[Math.round(az/45)%8]+" · "+Math.round(az)%360+"° az · "+Math.round(pitch)+"° alt";
    guide.textContent = "Drag or use arrow keys to look around. "+pathStatus;
  }
  async function update() {
    const enabled = !canvas.hidden && trail.checked && positions.some(p=>p.name===selected);
    const params = {...parameters(),target:selected};
    const key = enabled ? JSON.stringify(params) : "";
    if (key === pathKey) { draw(); return; }
    pathKey = key; samples = []; pathStatus = enabled ? "Calculating path…" : ""; draw();
    if (!enabled) return;
    try {
      const result = await api("path",params);
      if (pathKey !== key) return;
      samples = result;
      pathStatus = selected+" · next "+(isISS(selected) ? "12 minutes" : "6 hours")+
        (samples.some(p=>p && p.alt>=0) ? "" : " · below horizon");
    } catch { if (pathKey !== key) return; pathStatus = "Path unavailable."; }
    draw();
  }
  function mode(depth) {
    canvas.hidden = guide.hidden = $("trail-control").hidden = !depth;
    $("sky-map").toggleAttribute("hidden",depth);
    $("depth").setAttribute("aria-pressed",String(depth)); $("flat").setAttribute("aria-pressed",String(!depth));
    if (depth) { face(); canvas.focus(); }
    else document.querySelector(".chart-foot span:last-child").textContent = "Looking up · east on left";
    update(); if (!depth) renderChart();
  }
  $("flat").onclick = ()=>mode(false); $("depth").onclick = ()=>mode(true); trail.onchange = update;
  function pan(dx,dy) {
    heading = (heading+dx+360)%360; pitch = Math.max(0,Math.min(90,pitch+dy)); draw();
  }
  canvas.onkeydown = e => {
    const delta = {ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,5],ArrowDown:[0,-5]}[e.key];
    if (delta) { e.preventDefault(); pan(...delta); }
  };
  canvas.onpointerdown = e => {
    if (!e.isPrimary || e.button!==0) return;
    canvas.setPointerCapture(e.pointerId); drag = [e.clientX,e.clientY];
  };
  canvas.onpointermove = e => {
    if (!drag || !canvas.hasPointerCapture(e.pointerId)) return;
    const scale = 63/Math.min(canvas.clientWidth,canvas.clientHeight);
    pan((drag[0]-e.clientX)*scale,(e.clientY-drag[1])*scale); drag = [e.clientX,e.clientY];
  };
  canvas.onlostpointercapture = ()=>{ drag = null; };
  new ResizeObserver(draw).observe(canvas);
  return {face,update};
}
