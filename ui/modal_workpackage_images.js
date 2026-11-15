// ui/modal_workpackage_images.js
(function(){
  "use strict";

  const t = window.t;

  const API = "ui/modal_workpackage_images_tools.php";
  const MAX_MB = 5;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  const modalEl = document.getElementById("modalWorkpackageImages");
  if(!modalEl) return;

  const msgEl = document.getElementById("wpImgMsg");

  function setMsg(type, text){
    msgEl.classList.remove("d-none","alert-success","alert-danger","alert-warning","alert-info");
    msgEl.classList.add("alert-" + (type || "info"));
    msgEl.textContent = text || "";
  }
  function clearMsg(){ msgEl.classList.add("d-none"); msgEl.textContent=""; }

  function getSelectedWp(){
    return window.currentWorkpackage || null;
  }
  function getResearch(){
    return window.research || null;
  }

  async function apiGet(wp_id){
    const r = await fetch(`${API}?action=get&wp_id=${encodeURIComponent(wp_id)}`, {credentials:"same-origin"});
    const j = await r.json().catch(()=>null);
    if(!r.ok || !j) throw new Error((j && j.error) || t("errors.server_status", {status: r.status}));
    if(!j.success) throw new Error(j.error || t("modal.workpackage_images.error.failed"));
    return j.data;
  }

  async function apiUpload(wp_id, detBlob, icoBlob){
    const fd = new FormData();
    fd.append("wp_id", String(wp_id));
    if(detBlob) fd.append("det", detBlob, "wp_det.jpg");
    if(icoBlob) fd.append("ico", icoBlob, "wp_ico.jpg");

    const r = await fetch(`${API}?action=save`, {method:"POST", body:fd, credentials:"same-origin"});
    const j = await r.json().catch(()=>null);
    if(!r.ok || !j) throw new Error((j && j.error) || t("errors.server_status", {status: r.status}));
    if(!j.success) throw new Error(j.error || t("modal.workpackage_images.error.save_failed"));
    return j.data;
  }

  // ----- CropperCanvas (zoom/pan + touch) -----
  class CropperCanvas{
    constructor({canvas, dropzone, hintEl, outW, outH}){
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", {alpha:false});
      this.dropzone = dropzone;
      this.hintEl = hintEl;
      this.outW = outW;
      this.outH = outH;

      this.img = null;
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;

      this._dirty = false;
      this._drag = {on:false, x:0, y:0, ox:0, oy:0};
      this._touch = {active:false, mode:null, startX:0, startY:0, startOx:0, startOy:0, startZoom:1, startDist:0};

      this._bind();
      this.resizeToClient();
      this.render();
    }

    resizeToClient(){
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale(dpr, dpr);
      this.render();
    }

    setImage(img){
      this.img = img;
      this.resetView();
      this.hintEl.style.display = "none";
      this.render();
    }

    resetView(){
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
    }

    clear(){
      this.img = null;
      this._dirty = false;
      this.resetView();
      this.hintEl.style.display = "";
      this.render();
    }

    hasImage(){ return !!this.img; }
    markDirty(){ this._dirty = true; }
    isModified(){ return this._dirty; }

    _coverScale(){
      if(!this.img) return 1;
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;
      return Math.max(cw / this.img.naturalWidth, ch / this.img.naturalHeight);
    }
    _totalScale(){ return this._coverScale() * this.zoom; }

    _clampOffsets(){
      if(!this.img) return;
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;
      const s = this._totalScale();
      const iw = this.img.naturalWidth * s;
      const ih = this.img.naturalHeight * s;
      // più grande della cornice: si sposta senza scoprire i bordi; più piccola (logo rimpicciolito):
      // si sposta dentro la cornice senza uscirne (prima restava bloccata al centro)
      const maxX = Math.abs(iw - cw)/2;
      const maxY = Math.abs(ih - ch)/2;
      this.offsetX = Math.max(-maxX, Math.min(maxX, this.offsetX));
      this.offsetY = Math.max(-maxY, Math.min(maxY, this.offsetY));
    }

    render(){
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;

      this.ctx.clearRect(0,0,cw,ch);
      this.ctx.fillStyle = "#f2f2f2";
      this.ctx.fillRect(0,0,cw,ch);

      if(!this.img){
        this.hintEl.style.display = "";
        this.ctx.strokeStyle = "#e7e7e7";
        for(let x=0; x<cw; x+=40){ this.ctx.beginPath(); this.ctx.moveTo(x,0); this.ctx.lineTo(x,ch); this.ctx.stroke(); }
        for(let y=0; y<ch; y+=40){ this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(cw,y); this.ctx.stroke(); }
        return;
      }

      this._clampOffsets();

      const s = this._totalScale();
      const iw = this.img.naturalWidth * s;
      const ih = this.img.naturalHeight * s;
      const x = (cw - iw)/2 + this.offsetX;
      const y = (ch - ih)/2 + this.offsetY;

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(this.img, x, y, iw, ih);

      this.ctx.strokeStyle = "rgba(0,0,0,0.35)";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(1,1,cw-2,ch-2);
    }

    async exportBlob(){
      if(!this.img) return {blob:null, warnLowRes:false, lowResInfo:""};

      const out = document.createElement("canvas");
      out.width = this.outW;
      out.height = this.outH;
      const octx = out.getContext("2d", {alpha:false});
      octx.fillStyle = "#fff";
      octx.fillRect(0,0,this.outW,this.outH);

      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;
      const s = this._totalScale();

      const iwDraw = this.img.naturalWidth * s;
      const ihDraw = this.img.naturalHeight * s;
      const xDraw = (cw - iwDraw)/2 + this.offsetX;
      const yDraw = (ch - ihDraw)/2 + this.offsetY;

      const srcX = (0 - xDraw) / s;
      const srcY = (0 - yDraw) / s;
      const srcW = cw / s;
      const srcH = ch / s;

      const cropPixels = srcW * srcH;
      const destPixels = this.outW * this.outH;
      const warnLowRes = cropPixels < (destPixels / 4);
      const lowResInfo = t("modal.workpackage_images.low_res_info", {w: Math.round(srcW), h: Math.round(srcH), dw: this.outW, dh: this.outH});

      octx.imageSmoothingEnabled = true;
      octx.drawImage(this.img, srcX, srcY, srcW, srcH, 0, 0, this.outW, this.outH);

      const blob = await new Promise(resolve => out.toBlob(resolve, "image/jpeg", 0.9));
      return {blob, warnLowRes, lowResInfo};
    }

    _bind(){
      // mouse pan
      this.dropzone.addEventListener("mousedown", (e)=>{
        if(!this.img) return;
        e.preventDefault();
        this._drag.on = true;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._drag.ox = this.offsetX;
        this._drag.oy = this.offsetY;
      });
      window.addEventListener("mousemove", (e)=>{
        if(!this._drag.on) return;
        this.offsetX = this._drag.ox + (e.clientX - this._drag.x);
        this.offsetY = this._drag.oy + (e.clientY - this._drag.y);
        this.render();
      });
      window.addEventListener("mouseup", ()=>{ this._drag.on = false; });

      // wheel zoom
      this.dropzone.addEventListener("wheel", (e)=>{
        if(!this.img) return;
        e.preventDefault();
        const delta = Math.sign(e.deltaY);
        const factor = (delta > 0) ? 0.9 : 1.1;
        this.zoom = Math.max(0.2, Math.min(8, this.zoom * factor));
        this.render();
      }, {passive:false});

      // dblclick reset
      this.dropzone.addEventListener("dblclick", ()=>{
        if(!this.img) return;
        this.resetView();
        this.render();
      });

      // touch
      this.dropzone.addEventListener("touchstart", (e)=>{
        if(!this.img) return;
        if(e.touches.length === 1){
          const tp = e.touches[0];
          this._touch.active = true;
          this._touch.mode = "pan";
          this._touch.startX = tp.clientX;
          this._touch.startY = tp.clientY;
          this._touch.startOx = this.offsetX;
          this._touch.startOy = this.offsetY;
        } else if(e.touches.length === 2){
          const t1 = e.touches[0], t2 = e.touches[1];
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          this._touch.active = true;
          this._touch.mode = "pinch";
          this._touch.startDist = Math.hypot(dx,dy);
          this._touch.startZoom = this.zoom;
        }
      }, {passive:true});

      this.dropzone.addEventListener("touchmove", (e)=>{
        if(!this._touch.active || !this.img) return;
        if(this._touch.mode === "pan" && e.touches.length === 1){
          const tp = e.touches[0];
          this.offsetX = this._touch.startOx + (tp.clientX - this._touch.startX);
          this.offsetY = this._touch.startOy + (tp.clientY - this._touch.startY);
          this.render();
        } else if(this._touch.mode === "pinch" && e.touches.length === 2){
          const t1 = e.touches[0], t2 = e.touches[1];
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          const dist = Math.hypot(dx,dy);
          const ratio = dist / (this._touch.startDist || dist);
          this.zoom = Math.max(0.2, Math.min(8, this._touch.startZoom * ratio));
          this.render();
        }
      }, {passive:true});

      this.dropzone.addEventListener("touchend", ()=>{
        this._touch.active = false;
        this._touch.mode = null;
      }, {passive:true});

      // resize
      const ro = new ResizeObserver(()=>this.resizeToClient());
      ro.observe(this.dropzone);
      window.addEventListener("resize", ()=>this.resizeToClient());
    }
  }

  function loadImageFromFile(file){
    return new Promise((resolve, reject)=>{
      if(file.size > MAX_BYTES){
        reject(new Error(t("modal.workpackage_images.error.file_too_big", {mb: MAX_MB})));
        return;
      }
      const fr = new FileReader();
      fr.onload = ()=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = ()=>reject(new Error(t("modal.workpackage_images.error.invalid_image")));
        img.src = fr.result;
      };
      fr.onerror = ()=>reject(new Error(t("modal.workpackage_images.error.read_file")));
      fr.readAsDataURL(file);
    });
  }

  function hookDropzone(dz, fileInput, onImage){
    dz.addEventListener("dragover", (e)=>{ e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", ()=>dz.classList.remove("dragover"));
    dz.addEventListener("drop", async (e)=>{
      e.preventDefault();
      dz.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if(!file) return;
      try{ onImage(await loadImageFromFile(file)); }catch(err){ alert(err.message); }
    });

    fileInput.addEventListener("change", async ()=>{
      const file = fileInput.files?.[0];
      if(!file) return;
      try{ onImage(await loadImageFromFile(file)); }catch(err){ alert(err.message); }
      fileInput.value = "";
    });
  }

  const det = new CropperCanvas({
    canvas: document.getElementById("cvWpDet"),
    dropzone: document.getElementById("dzWpDet"),
    hintEl: document.getElementById("hintWpDet"),
    outW:1200, outH:400
  });

  const ico = new CropperCanvas({
    canvas: document.getElementById("cvWpIco"),
    dropzone: document.getElementById("dzWpIco"),
    hintEl: document.getElementById("hintWpIco"),
    outW:400, outH:400
  });

  document.getElementById("btnSelectWpDet").addEventListener("click", ()=>document.getElementById("fileWpDet").click());
  document.getElementById("btnSelectWpIco").addEventListener("click", ()=>document.getElementById("fileWpIco").click());
  document.getElementById("btnResetWpDet").addEventListener("click", ()=>{ det.resetView(); det.render(); });
  document.getElementById("btnResetWpIco").addEventListener("click", ()=>{ ico.resetView(); ico.render(); });

  hookDropzone(document.getElementById("dzWpDet"), document.getElementById("fileWpDet"), (img)=>{ det.setImage(img); det.markDirty(); });
  hookDropzone(document.getElementById("dzWpIco"), document.getElementById("fileWpIco"), (img)=>{ ico.setImage(img); ico.markDirty(); });

  async function loadExisting(){
    clearMsg();
    const wp = getSelectedWp();
    const r = getResearch();
    if(!wp?.wp_id || !r?.res_folder_name){
      setMsg("warning", t("modal.workpackage_images.no_wp.@"));
      return;
    }
    try{
      const data = await apiGet(wp.wp_id);
      if(data?.detUrl){
        const img = new Image();
        img.onload = ()=>det.setImage(img);
        img.src = data.detUrl;
      } else det.clear();

      if(data?.icoUrl){
        const img = new Image();
        img.onload = ()=>ico.setImage(img);
        img.src = data.icoUrl;
      } else ico.clear();

    }catch(e){
      // se non esistono ancora, non è un errore bloccante
      det.clear(); ico.clear();
    }
  }

  document.getElementById("btnSaveWpImages").addEventListener("click", async ()=>{
    clearMsg();
    const wp = getSelectedWp();
    if(!wp?.wp_id){
      setMsg("warning", t("modal.workpackage_images.no_wp.@"));
      return;
    }

    if(!det.isModified() && !ico.isModified()){
      setMsg("warning", t("modal.workpackage_images.nothing_changed"));
      return;
    }

    try{
      const detExp = det.isModified() ? await det.exportBlob() : {blob:null,warnLowRes:false,lowResInfo:""};
      const icoExp = ico.isModified() ? await ico.exportBlob() : {blob:null,warnLowRes:false,lowResInfo:""};

      if(detExp.warnLowRes || icoExp.warnLowRes){
        const parts = [];
        if(detExp.warnLowRes) parts.push("DET: " + detExp.lowResInfo);
        if(icoExp.warnLowRes) parts.push("ICO: " + icoExp.lowResInfo);
        const ok = confirm(t("modal.workpackage_images.confirm_low_res", {details: parts.join("\n")}));
        if(!ok) return;
      }

      setMsg("info", t("common.saving"));
      await apiUpload(wp.wp_id, detExp.blob, icoExp.blob);
      setMsg("success", t("modal.workpackage_images.saved"));
      await loadExisting();
    }catch(e){
      setMsg("danger", e.message);
    }
  });

  modalEl.addEventListener("shown.bs.modal", ()=>{
    det.resizeToClient(); ico.resizeToClient();
    loadExisting();
  });

  modalEl.addEventListener("hidden.bs.modal", ()=>{
    clearMsg();
    det.clear();
    ico.clear();
  });

})();
