import * as THREE from "three";

function contains(root, node) {
  for (let parent = node; parent; parent = parent.parent) {
    if (parent === root) return true;
  }
  return false;
}

function findImportedMotionRoot(model, clips) {
  const targets = new Set();
  const translating = new Set();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      const node = THREE.PropertyBinding.findNode(model, nodeName);
      if (!node) return null;
      targets.add(node);
      if (propertyName === "position") translating.add(node);
    }
  }

  // Follow a shared translating root only when it carries the visible model.
  const animatedNodes = [...targets];
  const root = [...translating].find(node => animatedNodes.every(target => contains(node, target)));
  if (!root) return null;
  let carriesModel = true;
  model.traverseVisible(node => {
    if (!(node.isMesh || node.isLine || node.isPoints) || contains(root, node)) return;
    if (!node.isSkinnedMesh || !node.skeleton.bones.every(bone => contains(root, bone))) carriesModel = false;
  });
  return carriesModel ? root : null;
}

export function createMotion(model, clips, config, { camera, controls, redraw, fit, reducedMotion, notice, local }) {
  const panel = document.querySelector("#motion");
  const get = (id) => panel.querySelector("#" + id);
  const picker = get("clip"), play = get("play-motion"), seek = get("motion-time");
  const speed = get("motion-speed"), loop = get("motion-loop"), follow = get("motion-follow");
  const timeLabel = get("motion-clock");
  const mixer = new THREE.AnimationMixer(model);
  const available = clips.filter((clip) => Number.isFinite(clip.duration) && clip.duration > 0);
  if (!available.length) return null;
  const events = new AbortController();
  const { signal } = events;
  const nodeName = typeof config.followNode === "string" && config.followNode.trim()
    ? THREE.PropertyBinding.sanitizeNodeName(config.followNode) : null;
  const matches = [];
  model.traverse((node) => {
    if (nodeName && node.name === nodeName) matches.push(node);
    // Imported skinned bounds may describe the bind pose far from a traveling root.
    if (node.isSkinnedMesh) node.frustumCulled = false;
  });
  const root = local ? findImportedMotionRoot(model, available) : matches.length === 1 ? matches[0] : null;
  if (nodeName && !root) notice("The animation follow node could not be identified.");
  get("motion-follow-label").hidden = !root;
  follow.checked = Boolean(local && root);
  loop.checked = config.loop === true;
  const point = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  let action, duration, time = 0, playing = false, suspended = false, previousTick = null;

  function setPlaying(value) {
    playing = value;
    previousTick = null;
    play.textContent = value ? "Pause" : "Play";
  }

  function apply(moveCamera = true) {
    if (suspended) return;
    // Pause the mixer clock so scrubbing and playback use the same exact, inclusive time.
    action.time = time;
    mixer.update(0);
    model.updateMatrixWorld(true);
    if (root) {
      root.getWorldPosition(point);
      if (follow.checked && moveCamera) {
        const delta = anchor.subVectors(point, anchor);
        camera.position.add(delta);
        controls.target.add(delta);
      }
      anchor.copy(point);
    }
    seek.value = String(time);
    seek.setAttribute("aria-valuetext", `${time.toFixed(2)} of ${duration.toFixed(2)} seconds`);
    timeLabel.value = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
    redraw();
  }

  function arm() {
    const clip = available[Number(picker.value)];
    action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.paused = true;
  }

  function select(fitView = true) {
    action?.stop();
    duration = available[Number(picker.value)].duration;
    seek.max = String(duration);
    time = 0;
    previousTick = null;
    arm();
    apply(false);
    if (fitView) fit();
  }

  available.forEach((clip, i) => picker.add(new Option(
    (typeof config.labels?.[clip.name] === "string" && config.labels[clip.name].trim())
      || clip.name || `Clip ${i + 1}`, String(i)
  )));
  const preferred = available.findIndex((clip) => clip.name === config.defaultClip);
  if (config.defaultClip && preferred < 0) notice("The default animation clip is unavailable.");
  picker.value = String(Math.max(0, preferred));
  select(false);
  panel.hidden = false;
  setPlaying(config.autoplay === true && !reducedMotion.matches);

  picker.addEventListener("change", () => select(), { signal });
  play.addEventListener("click", () => {
    if (!playing && time >= duration) {
      time = 0;
      apply();
    }
    setPlaying(!playing);
  }, { signal });
  seek.addEventListener("input", () => {
    setPlaying(false);
    time = Number(seek.value);
    apply();
  }, { signal });
  follow.addEventListener("change", () => {
    apply(false);
    if (follow.checked) fit();
  }, { signal });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) setPlaying(false);
  }, { signal });

  return {
    apply,
    tick(timestamp) {
      if (!playing) return;
      const elapsed = previousTick === null ? 0 : (timestamp - previousTick) / 1000;
      previousTick = timestamp;
      if (!elapsed) return;
      time += elapsed * Number(speed.value);
      if (time >= duration) {
        if (loop.checked) time %= duration;
        else {
          time = duration;
          setPlaying(false);
        }
      }
      apply();
    },
    resetClock() { previousTick = null; },
    dispose() {
      events.abort();
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      panel.hidden = true;
      picker.replaceChildren();
      speed.value = "1";
      follow.checked = false;
      get("motion-exploded").hidden = true;
      for (const input of panel.querySelectorAll("input,select,button")) input.disabled = false;
    },
    get suspended() { return suspended; },
    setSuspended(value) {
      if (value === suspended) return;
      suspended = value;
      for (const input of panel.querySelectorAll("input,select,button")) input.disabled = value;
      get("motion-exploded").hidden = !value;
      if (value) {
        // Mixer unbinding restores the original properties before the layout owns positions.
        setPlaying(false);
        action.stop();
      } else {
        arm();
        apply(false);
        fit();
      }
    },
    inspect() { return { clip: available[Number(picker.value)].name, time, playing, suspended }; },
  };
}
