document.addEventListener('DOMContentLoaded', function () {
	initWelcomeModal();
	initContactForm();
	initArchiveGallery();
	initTeams();
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

// "Add Team" button + form + "My Teams" list on the Team page. Only present
// when a logged-in user is viewing the page (see views/pages/participate.ejs).
function initTeams() {
	var addBtn = document.getElementById('add-team-btn');
	var form = document.getElementById('add-team-form');
	var list = document.getElementById('my-teams-list');
	if (!addBtn || !form || !list) return;

	var errorMsg = document.getElementById('team-form-error');

	// Team/season drill-down into a Roster, nested inside the same "My Teams"
	// box. Populated client-side from the teams already fetched below, rather
	// than a separate endpoint.
	var teamSelect = document.getElementById('team-select');
	var seasonGroup = document.getElementById('season-select-group');
	var seasonSelect = document.getElementById('season-select');
	var rosterBox = document.getElementById('roster-box');
	var rosterList = document.getElementById('roster-list');
	var updateRosterBtn = document.getElementById('update-roster-btn');
	var athleteForm = document.getElementById('add-athlete-form');
	var athleteErrorMsg = document.getElementById('athlete-form-error');

	var teamsData = [];
	var selectedTeamId = null;

	function renderTeams(teams) {
		list.innerHTML = '';

		if (!teams || teams.length === 0) {
			var empty = document.createElement('li');
			empty.className = 'team-list-empty';
			empty.textContent = 'No teams yet.';
			list.appendChild(empty);
			return;
		}

		teams.forEach(function (team) {
			list.appendChild(buildTeamListItem(team));
		});
	}

	function buildTeamListItem(team) {
		var item = document.createElement('li');
		item.className = 'team-list-item';

		var name = document.createElement('span');
		name.className = 'team-list-item-name';
		name.textContent = team.name;

		var meta = document.createElement('span');
		meta.className = 'team-list-item-meta';
		meta.textContent = team.sport + ' • ' + team.season;

		item.appendChild(name);
		item.appendChild(meta);
		return item;
	}

	function prependTeam(team) {
		var emptyItem = list.querySelector('.team-list-empty');
		if (emptyItem) emptyItem.remove();
		list.insertBefore(buildTeamListItem(team), list.firstChild);

		teamsData.push(team);
		populateTeamSelect();
	}

	function showError(message) {
		if (!errorMsg) return;
		errorMsg.textContent = message;
		errorMsg.hidden = false;
	}

	function hideError() {
		if (!errorMsg) return;
		errorMsg.hidden = true;
		errorMsg.textContent = '';
	}

	// Fills the Team dropdown with each distinct team name, in the order the
	// teams were first seen (teamsData is newest-first from the API).
	function populateTeamSelect() {
		if (!teamSelect) return;

		var previousValue = teamSelect.value;
		var seenNames = [];

		teamSelect.innerHTML = '';
		var placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.disabled = true;
		placeholder.textContent = 'Select a team';
		teamSelect.appendChild(placeholder);

		teamsData.forEach(function (team) {
			if (seenNames.indexOf(team.name) !== -1) return;
			seenNames.push(team.name);

			var option = document.createElement('option');
			option.value = team.name;
			option.textContent = team.name;
			teamSelect.appendChild(option);
		});

		if (seenNames.indexOf(previousValue) !== -1) {
			teamSelect.value = previousValue;
		} else {
			placeholder.selected = true;
		}
	}

	function resetSeasonAndRoster() {
		if (seasonGroup) seasonGroup.hidden = true;
		if (seasonSelect) seasonSelect.innerHTML = '<option value="" disabled selected>Select a season</option>';
		if (rosterBox) rosterBox.hidden = true;
		if (rosterList) rosterList.innerHTML = '';
		if (athleteForm) athleteForm.hidden = true;
		selectedTeamId = null;
	}

	function buildAthleteListItem(athlete) {
		var item = document.createElement('li');
		item.className = 'team-list-item';

		var name = document.createElement('span');
		name.className = 'team-list-item-name';
		name.textContent = athlete.name;

		item.appendChild(name);
		return item;
	}

	function renderRoster(athletes) {
		if (!rosterList) return;
		rosterList.innerHTML = '';

		if (!athletes || athletes.length === 0) {
			var empty = document.createElement('li');
			empty.className = 'team-list-empty';
			empty.textContent = 'No athletes yet.';
			rosterList.appendChild(empty);
			return;
		}

		athletes.forEach(function (athlete) {
			rosterList.appendChild(buildAthleteListItem(athlete));
		});
	}

	function loadRoster(teamId) {
		if (!rosterList) return;
		rosterList.innerHTML = '<li class="team-list-empty">Loading...</li>';

		fetch('/api/teams/' + teamId + '/athletes')
			.then(function (response) { return response.json(); })
			.then(function (data) { renderRoster(data.athletes); })
			.catch(function () {
				rosterList.innerHTML = '';
				var errorItem = document.createElement('li');
				errorItem.className = 'team-list-empty';
				errorItem.textContent = 'Unable to load roster right now.';
				rosterList.appendChild(errorItem);
			});
	}

	if (teamSelect && seasonGroup && seasonSelect) {
		teamSelect.addEventListener('change', function () {
			resetSeasonAndRoster();

			var name = teamSelect.value;
			if (!name) return;

			seasonSelect.innerHTML = '<option value="" disabled selected>Select a season</option>';
			teamsData
				.filter(function (team) { return team.name === name; })
				.forEach(function (team) {
					var option = document.createElement('option');
					option.value = team.id;
					option.textContent = team.season;
					seasonSelect.appendChild(option);
				});

			seasonGroup.hidden = false;
		});

		seasonSelect.addEventListener('change', function () {
			var teamId = seasonSelect.value;
			if (!teamId) return;

			selectedTeamId = teamId;
			if (rosterBox) rosterBox.hidden = false;
			if (athleteForm) athleteForm.hidden = true;
			loadRoster(teamId);
		});
	}

	if (updateRosterBtn && athleteForm) {
		updateRosterBtn.addEventListener('click', function () {
			athleteForm.hidden = !athleteForm.hidden;
		});
	}

	if (athleteForm) {
		athleteForm.addEventListener('submit', function (event) {
			event.preventDefault();

			if (athleteErrorMsg) {
				athleteErrorMsg.hidden = true;
				athleteErrorMsg.textContent = '';
			}

			var nameInput = athleteForm.querySelector('#athlete-name');
			var name = nameInput ? nameInput.value.trim() : '';

			if (!name) {
				if (athleteErrorMsg) {
					athleteErrorMsg.textContent = 'Please enter an athlete name.';
					athleteErrorMsg.hidden = false;
				}
				return;
			}
			if (!selectedTeamId) return;

			fetch('/api/teams/' + selectedTeamId + '/athletes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name }),
			})
				.then(function (response) {
					return response.json().then(function (data) {
						return { ok: response.ok, data: data };
					});
				})
				.then(function (result) {
					if (!result.ok) {
						if (athleteErrorMsg) {
							athleteErrorMsg.textContent = result.data.error || 'Something went wrong adding the athlete.';
							athleteErrorMsg.hidden = false;
						}
						return;
					}

					var emptyItem = rosterList.querySelector('.team-list-empty');
					if (emptyItem) emptyItem.remove();
					rosterList.appendChild(buildAthleteListItem(result.data.athlete));

					athleteForm.reset();
					athleteForm.hidden = true;
				})
				.catch(function () {
					if (athleteErrorMsg) {
						athleteErrorMsg.textContent = 'Something went wrong adding the athlete.';
						athleteErrorMsg.hidden = false;
					}
				});
		});
	}

	// Load the user's existing teams on page load.
	fetch('/api/teams')
		.then(function (response) { return response.json(); })
		.then(function (data) {
			teamsData = data.teams || [];
			renderTeams(teamsData);
			populateTeamSelect();
		})
		.catch(function () {
			list.innerHTML = '';
			var errorItem = document.createElement('li');
			errorItem.className = 'team-list-empty';
			errorItem.textContent = 'Unable to load teams right now.';
			list.appendChild(errorItem);
		});

	addBtn.addEventListener('click', function () {
		form.hidden = !form.hidden;
	});

	form.addEventListener('submit', function (event) {
		event.preventDefault();
		hideError();

		var name = form.querySelector('#team-name').value.trim();
		var season = parseInt(form.querySelector('#team-season').value, 10);
		var sport = form.querySelector('#team-sport').value;

		if (!name) {
			showError('Please enter a team name.');
			return;
		}
		if (!season) {
			showError('Please enter a valid season year.');
			return;
		}
		if (!sport) {
			showError('Please select a sport.');
			return;
		}

		fetch('/api/teams', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name, season: season, sport: sport }),
		})
			.then(function (response) {
				return response.json().then(function (data) {
					return { ok: response.ok, data: data };
				});
			})
			.then(function (result) {
				if (!result.ok) {
					showError(result.data.error || 'Something went wrong adding your team.');
					return;
				}

				prependTeam(result.data.team);
				form.reset();
				form.hidden = true;
			})
			.catch(function () {
				showError('Something went wrong adding your team.');
			});
	});
}
