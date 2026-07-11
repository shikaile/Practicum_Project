document.addEventListener('DOMContentLoaded', function () {
	initWelcomeModal();
	initContactForm();
	initArchiveGallery();
});

// Clicking an archive thumbnail opens the full, uncropped original image in
// a Fancybox lightbox (jQuery + Fancybox are loaded globally via partials/js.ejs).
function initArchiveGallery() {
	if (typeof window.jQuery === 'undefined' || !window.jQuery.fn.fancybox) return;

	window.jQuery('[data-fancybox="archive-gallery"]').fancybox({
		buttons: ['close'],
		clickContent: false,
	});
}

function initWelcomeModal() {
	var modal = document.getElementById('welcome-modal');
	if (!modal) return;

	var STORAGE_KEY = 'dsPracticumWelcomeModalSeen';

	function openModal() {
		modal.classList.add('open');
	}

	function closeModal() {
		modal.classList.remove('open');
	}

	// Only auto-open the modal the first time this browser ever visits the
	// home page. Once seen, the flag persists in localStorage so reloads and
	// later visits don't show it again.
	var alreadySeen = false;
	try {
		alreadySeen = window.localStorage.getItem(STORAGE_KEY) === 'true';
	} catch (e) {
		alreadySeen = false;
	}

	if (!alreadySeen) {
		openModal();
		try {
			window.localStorage.setItem(STORAGE_KEY, 'true');
		} catch (e) {
			// localStorage unavailable (private browsing, etc.) - no-op.
		}
	}

	modal.querySelectorAll('[data-modal-close]').forEach(function (btn) {
		btn.addEventListener('click', closeModal);
	});

	modal.addEventListener('click', function (event) {
		if (event.target === modal) {
			closeModal();
		}
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape') {
			closeModal();
		}
	});

	// Inline "Stay Updated" subscribe form inside the modal.
	var form = document.getElementById('modal-subscribe-form');
	if (!form) return;

	var successMsg = modal.querySelector('[data-modal-subscribe-success]');
	var errorMsg = modal.querySelector('[data-modal-subscribe-error]');

	form.addEventListener('submit', function (event) {
		event.preventDefault();

		var emailInput = form.querySelector('input[name="email"]');
		var email = emailInput ? emailInput.value : '';

		if (errorMsg) {
			errorMsg.hidden = true;
			errorMsg.textContent = '';
		}

		fetch(form.action, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'email=' + encodeURIComponent(email)
		})
			.then(function (response) {
				if (response.ok) {
					form.hidden = true;
					if (successMsg) successMsg.hidden = false;
				} else if (errorMsg) {
					errorMsg.textContent = 'Please enter a valid email.';
					errorMsg.hidden = false;
				}
			})
			.catch(function () {
				// Network/fetch failure - fall back to a normal form submission.
				form.submit();
			});
	});
}

function initContactForm() {
	var contactForm = document.getElementById('contact-form');
	if (!contactForm) return;

	contactForm.addEventListener('submit', function (event) {
		event.preventDefault();

		var nameInput = contactForm.querySelector('input[name="name"]');
		var dateInput = contactForm.querySelector('input[name="date"]');
		var commentInput = contactForm.querySelector('textarea[name="text"]');

		var name = nameInput ? nameInput.value.trim() : '';
		var date = dateInput ? dateInput.value.trim() : '';
		var comment = commentInput ? commentInput.value.trim() : '';

		var subject = [name, date].filter(Boolean).join(' - ');

		var mailtoUrl = 'mailto:cshotu.photography@gmail.com'
			+ '?subject=' + encodeURIComponent(subject)
			+ '&body=' + encodeURIComponent(comment);

		window.location.href = mailtoUrl;
	});
}
