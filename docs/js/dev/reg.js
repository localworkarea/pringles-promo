import "./main.min.js";
import "./common.min.js";
//#region src/components/forms/_functions.js
var formValidate = {
	getErrors(form) {
		let error = 0;
		let formRequiredItems = form.querySelectorAll("[required]");
		if (formRequiredItems.length) formRequiredItems.forEach((formRequiredItem) => {
			if ((formRequiredItem.offsetParent !== null || formRequiredItem.tagName === "SELECT") && !formRequiredItem.disabled) error += this.validateInput(formRequiredItem);
		});
		return error;
	},
	validateInput(formRequiredItem) {
		let error = 0;
		if (formRequiredItem.type === "email") {} else if (formRequiredItem.type === "checkbox" && !formRequiredItem.checked) {} else if (!formRequiredItem.value.trim()) {
			this.addError(formRequiredItem);
			this.removeSuccess(formRequiredItem);
			error++;
		} else if (formRequiredItem.hasAttribute("pattern") && !formRequiredItem.checkValidity()) {
			this.addError(formRequiredItem, formRequiredItem.dataset.attFormErrtextPattern);
			this.removeSuccess(formRequiredItem);
			error++;
		} else {
			this.removeError(formRequiredItem);
			this.addSuccess(formRequiredItem);
		}
		return error;
	},
	addError(formRequiredItem, message) {
		formRequiredItem.classList.add("--form-error");
		formRequiredItem.parentElement.classList.add("--form-error");
		let inputError = formRequiredItem.parentElement.querySelector("[data-att-form-error]");
		if (inputError) formRequiredItem.parentElement.removeChild(inputError);
		const text = message || formRequiredItem.dataset.attFormErrtext;
		if (text) formRequiredItem.parentElement.insertAdjacentHTML("beforeend", `<div data-att-form-error>${text}</div>`);
	},
	removeError(formRequiredItem) {
		formRequiredItem.classList.remove("--form-error");
		formRequiredItem.parentElement.classList.remove("--form-error");
		if (formRequiredItem.parentElement.querySelector("[data-att-form-error]")) formRequiredItem.parentElement.removeChild(formRequiredItem.parentElement.querySelector("[data-att-form-error]"));
	},
	addSuccess(formRequiredItem) {
		formRequiredItem.classList.add("--form-success");
		formRequiredItem.parentElement.classList.add("--form-success");
	},
	removeSuccess(formRequiredItem) {
		formRequiredItem.classList.remove("--form-success");
		formRequiredItem.parentElement.classList.remove("--form-success");
	},
	removeFocus(formRequiredItem) {
		formRequiredItem.classList.remove("--form-focus");
		formRequiredItem.parentElement.classList.remove("--form-focus");
	},
	formClean(form) {
		form.reset();
		setTimeout(() => {
			let inputs = form.querySelectorAll("input,textarea");
			for (let index = 0; index < inputs.length; index++) {
				const el = inputs[index];
				formValidate.removeFocus(el);
				formValidate.removeSuccess(el);
				formValidate.removeError(el);
			}
		}, 0);
	},
	emailTest(formRequiredItem) {
		return !/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,8})+$/.test(formRequiredItem.value);
	}
};
//#endregion
//#region src/components/forms/form/steps.js
var STEP_ACTIVE = "--form-step-active";
function initSteps(form) {
	const steps = [...form.querySelectorAll("[data-att-form-step]")];
	if (steps.length < 2) return;
	const actionOf = (step) => step.querySelector("[data-att-form-next], [type='submit']");
	const isFilled = (step) => [...step.querySelectorAll("[required]")].every((field) => {
		if (field.type === "checkbox") return field.checked;
		if (!field.value.trim()) return false;
		return !field.hasAttribute("pattern") || field.checkValidity();
	});
	const activeStep = () => steps.find((step) => step.classList.contains(STEP_ACTIVE));
	function refresh() {
		const step = activeStep();
		if (!step) return;
		const action = actionOf(step);
		if (action) action.disabled = !isFilled(step);
	}
	function goTo(index) {
		steps.forEach((step, i) => step.classList.toggle(STEP_ACTIVE, i === index));
		refresh();
	}
	form.addEventListener("input", refresh);
	form.addEventListener("change", refresh);
	form.addEventListener("click", (event) => {
		if (!event.target.closest("[data-att-form-next]")) return;
		if (formValidate.getErrors(form) !== 0) return;
		const index = steps.indexOf(activeStep());
		if (index > -1 && index < steps.length - 1) goTo(index + 1);
	});
	form.addEventListener("reset", () => setTimeout(() => goTo(0), 0));
	goTo(0);
}
function formStepsInit() {
	document.querySelectorAll("[data-att-form-steps]").forEach(initSteps);
}
//#endregion
//#region src/components/forms/form/file.js
var ALLOWED = {
	"image/jpeg": [".jpg", ".jpeg"],
	"image/png": [".png"],
	"image/webp": [".webp"],
	"image/heic": [".heic"],
	"image/heif": [".heif"],
	"application/pdf": [".pdf"]
};
var ALLOWED_EXT = [...new Set(Object.values(ALLOWED).flat())];
var DEFAULT_MAX_MB = 10;
function initFile(input) {
	const holder = input.parentElement;
	const nameNode = holder.querySelector("[data-att-form-file-name]");
	if (!nameNode) return;
	const placeholder = nameNode.textContent.trim();
	const maxMb = parseFloat(input.dataset.attFormFileMax) || DEFAULT_MAX_MB;
	function reset() {
		nameNode.textContent = placeholder;
		holder.classList.remove("--form-file-filled");
	}
	function reject(message) {
		input.value = "";
		reset();
		formValidate.addError(input, message);
	}
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return reset();
		const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
		const typeMatches = !file.type || ALLOWED[file.type]?.includes(ext);
		if (!ALLOWED_EXT.includes(ext) || !typeMatches) return reject(`Дозволені формати: ${ALLOWED_EXT.join(", ")}`);
		if (file.size > maxMb * 1024 * 1024) return reject(`Файл завеликий — максимум ${maxMb} МБ`);
		formValidate.removeError(input);
		nameNode.textContent = file.name;
		holder.classList.add("--form-file-filled");
	});
	input.form?.addEventListener("reset", () => setTimeout(reset, 0));
}
function formFileInit() {
	document.querySelectorAll("[data-att-form-file]").forEach(initFile);
}
//#endregion
//#region src/components/forms/form/phone.js
var PREFIX = "+38-(0";
var PREFIX_DIGITS = 3;
var MAX_DIGITS = 9;
function format(digits) {
	let out = PREFIX + digits.slice(0, 2);
	if (digits.length > 2) out += `)-${digits.slice(2, 5)}`;
	if (digits.length > 5) out += `-${digits.slice(5, 7)}`;
	if (digits.length > 7) out += `-${digits.slice(7, 9)}`;
	return out;
}
function normalize(value) {
	let rest = value.replace(/\D/g, "");
	let offset = 0;
	if (rest.startsWith("380")) {
		rest = rest.slice(3);
		offset = 3;
	}
	while (rest.length > MAX_DIGITS) if (rest.startsWith("380")) {
		rest = rest.slice(3);
		offset += 3;
	} else if (rest.startsWith("38")) {
		rest = rest.slice(2);
		offset += 2;
	} else if (rest.startsWith("0")) {
		rest = rest.slice(1);
		offset += 1;
	} else break;
	return {
		digits: rest.slice(0, MAX_DIGITS),
		offset
	};
}
function initPhone(input) {
	const caretToEndOfPrefix = () => input.setSelectionRange(6, 6);
	function caretAfter(count) {
		if (count <= 0) return 6;
		let seen = 0;
		for (let i = 0; i < input.value.length; i++) {
			if (!/\d/.test(input.value[i])) continue;
			seen++;
			if (seen === count + PREFIX_DIGITS) return i + 1;
		}
		return input.value.length;
	}
	input.addEventListener("focus", () => {
		if (!input.value) input.value = PREFIX;
		requestAnimationFrame(() => {
			if ((input.selectionStart ?? 0) < 6) caretToEndOfPrefix();
		});
	});
	input.addEventListener("click", () => {
		if ((input.selectionStart ?? 0) < 6) caretToEndOfPrefix();
	});
	input.addEventListener("beforeinput", (event) => {
		const start = input.selectionStart ?? 0;
		if (start !== (input.selectionEnd ?? 0)) return;
		if (event.inputType.startsWith("delete")) {
			if (event.inputType.includes("Backward") ? start <= 6 : start < 6) event.preventDefault();
			return;
		}
		if (start < 6) caretToEndOfPrefix();
	});
	input.addEventListener("input", () => {
		const caret = input.selectionStart ?? input.value.length;
		const digitsLeft = (input.value.slice(0, caret).match(/\d/g) || []).length;
		const { digits, offset } = normalize(input.value);
		const typedLeft = Math.max(0, digitsLeft - offset);
		input.value = format(digits);
		const position = caretAfter(Math.min(typedLeft, digits.length));
		input.setSelectionRange(position, position);
	});
	input.addEventListener("blur", () => {
		if (!normalize(input.value).digits.length) input.value = "";
	});
}
function formPhoneInit() {
	document.querySelectorAll("[data-att-form-phone]").forEach(initPhone);
}
//#endregion
//#region src/components/forms/form/form.js
document.addEventListener("formSent", (event) => {
	const sentClass = event.detail.form.dataset.attFormSentclass;
	if (sentClass) document.documentElement.classList.add(sentClass);
});
function formInit() {
	function formSubmit() {
		const forms = document.forms;
		if (forms.length) for (const form of forms) {
			!form.hasAttribute("data-att-form-novalidate") && form.setAttribute("novalidate", true);
			form.addEventListener("submit", function(e) {
				const form = e.target;
				formSubmitAction(form, e);
			});
			form.addEventListener("reset", function(e) {
				const form = e.target;
				formValidate.formClean(form);
			});
		}
		async function formSubmitAction(form, e) {
			if (formValidate.getErrors(form) === 0) {
				if (form.dataset.attForm === "ajax") {
					e.preventDefault();
					const formAction = form.getAttribute("action") ? form.getAttribute("action").trim() : "#";
					const formMethod = form.getAttribute("method") ? form.getAttribute("method").trim() : "GET";
					const formData = new FormData(form);
					form.classList.add("--sending");
					const response = await fetch(formAction, {
						method: formMethod,
						body: formData
					});
					if (response.ok) {
						let responseResult = await response.json();
						form.classList.remove("--sending");
						formSent(form, responseResult);
					} else form.classList.remove("--sending");
				} else if (form.dataset.attForm === "dev") {
					e.preventDefault();
					formSent(form);
				}
			} else {
				e.preventDefault();
				if (form.querySelector(".--form-error") && form.hasAttribute("data-att-form-gotoerr")) form.dataset.attFormGotoerr && form.dataset.attFormGotoerr;
			}
		}
		function formSent(form, responseResult = ``) {
			document.dispatchEvent(new CustomEvent("formSent", { detail: { form } }));
			setTimeout(() => {
				if (window.flsPopup) {
					const popup = form.dataset.attFormPopup;
					popup && window.flsPopup.open(popup);
				}
			}, 0);
			formValidate.formClean(form);
		}
	}
	function formFieldsInit() {
		document.body.addEventListener("focusin", function(e) {
			const targetElement = e.target;
			if (targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA") {
				if (!targetElement.hasAttribute("data-att-form-nofocus")) {
					targetElement.classList.add("--form-focus");
					targetElement.parentElement.classList.add("--form-focus");
				}
				targetElement.hasAttribute("data-att-form-validatenow") && formValidate.removeError(targetElement);
			}
		});
		document.body.addEventListener("focusout", function(e) {
			const targetElement = e.target;
			if (targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA") {
				if (!targetElement.hasAttribute("data-att-form-nofocus")) {
					targetElement.classList.remove("--form-focus");
					targetElement.parentElement.classList.remove("--form-focus");
				}
				targetElement.hasAttribute("data-att-form-validatenow") && formValidate.validateInput(targetElement);
			}
		});
	}
	formSubmit();
	formFieldsInit();
	formFileInit();
	formPhoneInit();
	formStepsInit();
}
document.querySelector("[data-att-form]") && window.addEventListener("load", formInit);
//#endregion
