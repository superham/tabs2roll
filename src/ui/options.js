// Settings page. Nothing here is required for the happy path; the defaults
// are what a first-time user gets without ever opening this page.
import { fillStrings, getOptions, setOptions, DEFAULT_OPTIONS, STRINGS } from "./common.js";

const $ = (id) => document.getElementById(id);

function render(options) {
  $("step").value = options.step;
  $("arrange").checked = options.arrange !== false;
}

function save() {
  const options = { step: $("step").value, arrange: $("arrange").checked };
  setOptions(options);
  $("status").textContent = STRINGS.options.saved;
  setTimeout(() => {
    $("status").textContent = "";
  }, 1500);
}

fillStrings();
render(getOptions());
$("step").addEventListener("change", save);
$("arrange").addEventListener("change", save);
$("reset").addEventListener("click", () => {
  render(DEFAULT_OPTIONS);
  save();
});
