document.addEventListener('DOMContentLoaded', function () {
	initWelcomeModal();
	initContactForm();
	initArchiveGallery();
	initTeams();
	initGamePage();
	initGameClock();
	initQuarterToggles();
	initStatButtons();
	initEndRecordGame();
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

	// Swaps an athlete's name span for an inline rename form. Only one row
	// can be mid-edit at a time per item (guarded by the existing-form check).
	function startAthleteRename(item, nameEl, actionsEl, athlete) {
		if (item.querySelector('.athlete-rename-form')) return;

		var form = document.createElement('form');
		form.className = 'athlete-rename-form';

		var input = document.createElement('input');
		input.type = 'text';
		input.className = 'feedback-input';
		input.maxLength = 100;
		input.value = athlete.name;
		input.required = true;

		var saveBtn = document.createElement('button');
		saveBtn.type = 'submit';
		saveBtn.className = 'athlete-action-btn';
		saveBtn.textContent = 'Save';

		var cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'athlete-action-btn';
		cancelBtn.textContent = 'Cancel';

		form.appendChild(input);
		form.appendChild(saveBtn);
		form.appendChild(cancelBtn);

		nameEl.replaceWith(form);
		actionsEl.hidden = true;
		input.focus();
		input.select();

		function exitEditMode(newName) {
			if (typeof newName === 'string') {
				nameEl.textContent = newName;
				athlete.name = newName;
			}
			form.replaceWith(nameEl);
			actionsEl.hidden = false;
		}

		cancelBtn.addEventListener('click', function () {
			exitEditMode();
		});

		form.addEventListener('submit', function (event) {
			event.preventDefault();
			var newName = input.value.trim();

			if (!newName) return;
			if (newName === athlete.name) {
				exitEditMode();
				return;
			}

			saveBtn.disabled = true;
			cancelBtn.disabled = true;

			fetch('/api/teams/' + selectedTeamId + '/athletes/' + athlete.id, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName }),
			})
				.then(function (response) {
					return response.json().then(function (data) {
						return { ok: response.ok, data: data };
					});
				})
				.then(function (result) {
					if (!result.ok) {
						saveBtn.disabled = false;
						cancelBtn.disabled = false;
						alert(result.data.error || 'Something went wrong renaming the athlete.');
						return;
					}
					exitEditMode(result.data.athlete.name);
				})
				.catch(function () {
					saveBtn.disabled = false;
					cancelBtn.disabled = false;
					alert('Something went wrong renaming the athlete.');
				});
		});
	}

	function removeAthlete(item, athlete) {
		if (!confirm('Remove ' + athlete.name + ' from the roster?')) return;

		fetch('/api/teams/' + selectedTeamId + '/athletes/' + athlete.id, { method: 'DELETE' })
			.then(function (response) {
				if (!response.ok && response.status !== 404) {
					throw new Error('Delete failed with status ' + response.status);
				}
				item.remove();

				if (!rosterList.querySelector('.team-list-item')) {
					var empty = document.createElement('li');
					empty.className = 'team-list-empty';
					empty.textContent = 'No athletes yet.';
					rosterList.appendChild(empty);
				}
			})
			.catch(function () {
				alert('Something went wrong removing the athlete.');
			});
	}

	function buildAthleteListItem(athlete) {
		var item = document.createElement('li');
		item.className = 'team-list-item';

		var name = document.createElement('span');
		name.className = 'team-list-item-name';
		name.textContent = athlete.name;

		var actions = document.createElement('span');
		actions.className = 'team-list-item-actions';

		var renameBtn = document.createElement('button');
		renameBtn.type = 'button';
		renameBtn.className = 'athlete-action-btn';
		renameBtn.textContent = 'Rename';

		var removeBtn = document.createElement('button');
		removeBtn.type = 'button';
		removeBtn.className = 'athlete-action-btn athlete-action-btn-danger';
		removeBtn.textContent = 'Remove';

		actions.appendChild(renameBtn);
		actions.appendChild(removeBtn);

		item.appendChild(name);
		item.appendChild(actions);

		renameBtn.addEventListener('click', function () {
			startAthleteRename(item, name, actions, athlete);
		});

		removeBtn.addEventListener('click', function () {
			removeAthlete(item, athlete);
		});

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

// Shared state for the Game page's live stat-logging flow. Everything here
// is purely client-side and in-memory - nothing is sent to the database
// until the coach clicks "End/Record Game" and confirms (see
// initEndRecordGame below). playerStatsByName accumulates each selected
// athlete's stat-button clicks locally; selecting an athlete just reads
// from this map instead of the server.
var gameTrackingState = {
	teamName: null,
	selectedPlayerName: null,
	selectedItemEl: null,
	playerStatsByName: {},
};

// Only one team can be tracked per game on this page (see
// views/pages/projects.ejs, which now renders a single .matchup-side).
// Lets the user pick one of their teams and then shows that team's roster.
// Only present when a logged-in user is viewing the page.
function initGamePage() {
	var sides = document.querySelectorAll('.matchup-side');
	if (!sides.length) return;

	var teamsPromise = fetch('/api/teams')
		.then(function (response) { return response.json(); })
		.then(function (data) { return data.teams || []; })
		.catch(function () { return null; });

	sides.forEach(function (side) {
		initGameSide(side, teamsPromise);
	});
}

function initGameSide(side, teamsPromise) {
	var addBtn = side.querySelector('.game-add-team-btn');
	var picker = side.querySelector('.game-team-picker');
	var rosterBox = side.querySelector('.game-roster');
	var rosterTitle = side.querySelector('.game-roster-title');
	var rosterList = side.querySelector('.game-roster-list');
	if (!addBtn || !picker || !rosterBox || !rosterTitle || !rosterList) return;

	addBtn.addEventListener('click', function () {
		picker.hidden = !picker.hidden;
	});

	function selectTeam(team) {
		picker.hidden = true;
		rosterTitle.textContent = team.name + ' (' + team.sport + ' • ' + team.season + ')';
		rosterBox.hidden = false;
		gameTrackingState.teamName = team.name;
		loadGameRoster(team.id, rosterList);
	}

	teamsPromise.then(function (teams) {
		picker.innerHTML = '';

		if (!teams) {
			var errorItem = document.createElement('li');
			errorItem.className = 'team-list-empty';
			errorItem.textContent = 'Unable to load teams right now.';
			picker.appendChild(errorItem);
			return;
		}

		if (teams.length === 0) {
			var empty = document.createElement('li');
			empty.className = 'team-list-empty';
			empty.textContent = 'No teams yet. Add one on the Team page.';
			picker.appendChild(empty);
			return;
		}

		teams.forEach(function (team) {
			var item = document.createElement('li');
			item.className = 'team-list-item game-team-option';
			item.tabIndex = 0;
			item.setAttribute('role', 'button');

			var name = document.createElement('span');
			name.className = 'team-list-item-name';
			name.textContent = team.name;

			var meta = document.createElement('span');
			meta.className = 'team-list-item-meta';
			meta.textContent = team.sport + ' • ' + team.season;

			item.appendChild(name);
			item.appendChild(meta);

			item.addEventListener('click', function () { selectTeam(team); });
			item.addEventListener('keydown', function (event) {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					selectTeam(team);
				}
			});

			picker.appendChild(item);
		});
	});
}

function loadGameRoster(teamId, rosterList) {
	rosterList.innerHTML = '<li class="team-list-empty">Loading...</li>';

	fetch('/api/teams/' + teamId + '/athletes')
		.then(function (response) { return response.json(); })
		.then(function (data) {
			rosterList.innerHTML = '';
			var athletes = data.athletes || [];

			if (athletes.length === 0) {
				var empty = document.createElement('li');
				empty.className = 'team-list-empty';
				empty.textContent = 'No athletes yet.';
				rosterList.appendChild(empty);
				return;
			}

			athletes.forEach(function (athlete) {
				var item = document.createElement('li');
				item.className = 'team-list-item game-athlete-option';
				item.tabIndex = 0;
				item.setAttribute('role', 'button');

				var name = document.createElement('span');
				name.className = 'team-list-item-name';
				name.textContent = athlete.name;

				item.appendChild(name);

				item.addEventListener('click', function () { selectAthlete(athlete.name, item); });
				item.addEventListener('keydown', function (event) {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						selectAthlete(athlete.name, item);
					}
				});

				rosterList.appendChild(item);
			});
		})
		.catch(function () {
			rosterList.innerHTML = '';
			var errorItem = document.createElement('li');
			errorItem.className = 'team-list-empty';
			errorItem.textContent = 'Unable to load roster right now.';
			rosterList.appendChild(errorItem);
		});
}

// 8-minute start/stop game clock on the Game page. Purely client-side (no
// persistence) - resets to 08:00 on page reload.
// Set by initGameClock so clearGameFields (after a successful "End/Record
// Game") can stop and reset the clock without restructuring its closures.
var gameClockControls = null;

// Q1-Q4 quarter buttons - only one is ever active at a time (a game is in
// exactly one quarter), shared by manual clicks (initQuarterToggles) and
// the game clock's automatic advance-on-expire (initGameClock).
var QUARTER_SEQUENCE = ['Q1', 'Q2', 'Q3', 'Q4'];

function setActiveQuarter(quarterKey) {
	document.querySelectorAll('.quarter-btn').forEach(function (btn) {
		btn.classList.toggle('active', btn.dataset.quarter === quarterKey);
	});
}

function getActiveQuarter() {
	var activeBtn = document.querySelector('.quarter-btn.active');
	return activeBtn ? activeBtn.dataset.quarter : null;
}

// Moves to the next quarter in sequence. No-op past Q4 - the clock just
// stays reset and stopped, waiting for the coach to start it again.
function advanceToNextQuarter() {
	var currentIndex = QUARTER_SEQUENCE.indexOf(getActiveQuarter());
	var nextIndex = currentIndex + 1;
	if (nextIndex < QUARTER_SEQUENCE.length) {
		setActiveQuarter(QUARTER_SEQUENCE[nextIndex]);
	}
}

// Q1-Q4 quarter buttons on the Game page - clicking one selects it (and
// deselects the rest); clicking the already-active one clears the
// selection. No persistence.
function initQuarterToggles() {
	var buttons = document.querySelectorAll('.quarter-btn');
	if (!buttons.length) return;

	buttons.forEach(function (btn) {
		btn.addEventListener('click', function () {
			var isActive = btn.classList.contains('active');
			setActiveQuarter(isActive ? null : btn.dataset.quarter);
		});
	});
}

// 8-minute quarter clock. Can be paused and resumed without losing the
// remaining time. Starting it from a fresh 08:00 with no quarter selected
// yet activates Q1; each time it counts down to 0:00 it resets to 08:00
// and automatically advances to the next quarter (Q2, then Q3, then Q4),
// stopped and waiting for the coach to start it again.
function initGameClock() {
	var display = document.getElementById('game-clock-display');
	var toggleBtn = document.getElementById('game-clock-toggle');
	if (!display || !toggleBtn) return;

	var START_SECONDS = 8 * 60;
	var remainingSeconds = START_SECONDS;
	var intervalId = null;

	function formatTime(totalSeconds) {
		var minutes = Math.floor(totalSeconds / 60);
		var seconds = totalSeconds % 60;
		return (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
	}

	function render() {
		display.textContent = formatTime(remainingSeconds);
	}

	// Pauses without resetting - the remaining time is kept, so clicking
	// the button again resumes the countdown instead of restarting it.
	function pause() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
		toggleBtn.textContent = remainingSeconds === START_SECONDS ? 'Start' : 'Resume';
		toggleBtn.classList.remove('active');
	}

	// Called when the countdown runs out on its own (not a manual pause) -
	// advances the quarter and resets the clock for the next one.
	function handleExpired() {
		clearInterval(intervalId);
		intervalId = null;
		advanceToNextQuarter();
		remainingSeconds = START_SECONDS;
		render();
		toggleBtn.textContent = 'Start';
		toggleBtn.classList.remove('active');
	}

	function start() {
		if (intervalId || remainingSeconds <= 0) return;

		// First-ever start of the game (fresh clock, no quarter picked yet)
		// - later quarters get activated automatically by handleExpired.
		if (!getActiveQuarter()) {
			setActiveQuarter('Q1');
		}

		intervalId = setInterval(function () {
			remainingSeconds -= 1;
			render();
			if (remainingSeconds <= 0) handleExpired();
		}, 1000);

		toggleBtn.textContent = 'Pause';
		toggleBtn.classList.add('active');
	}

	function reset() {
		pause();
		remainingSeconds = START_SECONDS;
		render();
		toggleBtn.textContent = 'Start';
	}

	toggleBtn.addEventListener('click', function () {
		if (intervalId) {
			pause();
		} else {
			start();
		}
	});

	render();
	gameClockControls = { reset: reset };
}

// Writes a player's locally-tracked stats (or all zeros, if null) onto the
// stat buttons' displayed counts, including the derived Total Points
// button (computed here, since nothing is sent to - or computed by - the
// server until "End/Record Game" is confirmed).
function applyBoxScoreToButtons(stats) {
	document.querySelectorAll('.stat-btn[data-stat]').forEach(function (btn) {
		var countEl = btn.querySelector('.stat-btn-count');
		if (!countEl) return;
		var value = stats ? stats[btn.dataset.stat] : 0;
		countEl.textContent = String(typeof value === 'number' ? value : 0);
	});

	var totalBtn = document.getElementById('stat-total-points');
	if (totalBtn) {
		var totalCount = totalBtn.querySelector('.stat-btn-count');
		var points = stats ? (stats.fgm || 0) * 2 + (stats.tpm || 0) * 3 + (stats.ftm || 0) : 0;
		if (totalCount) totalCount.textContent = String(points);
	}
}

// Selecting an athlete (from the team's roster) makes them the target of
// the stat buttons below - clicking a stat button updates their entry in
// gameTrackingState.playerStatsByName, purely in-memory.
function selectAthlete(playerName, itemEl) {
	if (gameTrackingState.selectedItemEl) {
		gameTrackingState.selectedItemEl.classList.remove('selected');
	}
	itemEl.classList.add('selected');
	gameTrackingState.selectedItemEl = itemEl;
	gameTrackingState.selectedPlayerName = playerName;

	if (!gameTrackingState.playerStatsByName[playerName]) {
		gameTrackingState.playerStatsByName[playerName] = {};
	}
	applyBoxScoreToButtons(gameTrackingState.playerStatsByName[playerName]);

	var status = document.getElementById('stat-status');
	if (status) status.textContent = 'Logging stats for: ' + playerName;
}

// Stat-logging buttons on the Game page (FG Att., FG Made, etc.) - each
// click updates whichever athlete is currently selected, entirely
// client-side. Nothing reaches the database until "End/Record Game" is
// clicked and confirmed (see initEndRecordGame below).
// A made shot is always also an attempt, so logging a make bumps the
// matching attempt stat by the same amount (and a correction via the minus
// button un-bumps it too, so the two never drift out of sync).
var MADE_TO_ATTEMPT_STAT = {
	fgm: 'fga',
	tpm: 'tpa',
	ftm: 'fta',
};

function initStatButtons() {
	// Each stat has two controls sharing the same data-stat: the main
	// .stat-btn (data-delta="1") and a small .stat-btn-minus (data-delta="-1")
	// to correct a mis-click without resetting the whole game.
	var buttons = document.querySelectorAll('.stat-btn[data-stat], .stat-btn-minus[data-stat]');
	if (!buttons.length) return;

	buttons.forEach(function (btn) {
		btn.addEventListener('click', function () {
			var status = document.getElementById('stat-status');

			if (!gameTrackingState.selectedPlayerName) {
				if (status) status.textContent = 'Select an athlete above before logging a stat.';
				return;
			}

			var playerName = gameTrackingState.selectedPlayerName;
			var stat = btn.dataset.stat;
			var delta = btn.dataset.delta ? parseInt(btn.dataset.delta, 10) : 1;

			var stats = gameTrackingState.playerStatsByName[playerName];
			if (!stats) {
				stats = {};
				gameTrackingState.playerStatsByName[playerName] = stats;
			}
			stats[stat] = Math.max((stats[stat] || 0) + delta, 0);

			var attemptStat = MADE_TO_ATTEMPT_STAT[stat];
			if (attemptStat) {
				stats[attemptStat] = Math.max((stats[attemptStat] || 0) + delta, 0);
			}

			applyBoxScoreToButtons(stats);
			if (status) status.textContent = 'Logging stats for: ' + playerName;
		});
	});
}

// Resets the Game page back to a blank slate after a game has been
// successfully recorded: clears tracked stats, deselects the athlete,
// resets the clock and quarter toggles, and puts the team slot back to
// "Add Team" so a new game can be tracked.
function clearGameFields() {
	gameTrackingState.teamName = null;
	gameTrackingState.selectedPlayerName = null;
	if (gameTrackingState.selectedItemEl) {
		gameTrackingState.selectedItemEl.classList.remove('selected');
	}
	gameTrackingState.selectedItemEl = null;
	gameTrackingState.playerStatsByName = {};

	applyBoxScoreToButtons(null);

	if (gameClockControls) gameClockControls.reset();

	document.querySelectorAll('.quarter-btn').forEach(function (btn) {
		btn.classList.remove('active');
	});

	document.querySelectorAll('.matchup-side').forEach(function (side) {
		var picker = side.querySelector('.game-team-picker');
		var rosterBox = side.querySelector('.game-roster');
		var rosterList = side.querySelector('.game-roster-list');
		if (picker) picker.hidden = true;
		if (rosterBox) rosterBox.hidden = true;
		if (rosterList) rosterList.innerHTML = '';
	});

	var endBtn = document.getElementById('end-record-game-btn');
	var confirmSection = document.getElementById('end-game-confirm');
	if (confirmSection) confirmSection.hidden = true;
	if (endBtn) endBtn.hidden = false;
}

// "End/Record Game" button + its confirmation step. Nothing is sent to the
// database until the coach clicks "End/Record Game" and then confirms;
// clicking "End/Record Game" itself only reveals the confirmation - it
// doesn't send anything yet. On success, sends every tracked athlete's
// accumulated stats in one request to /api/advanced-stats/record-game (the
// same game_records/player_stats tables CSV uploads write to), then clears
// the page via clearGameFields.
function initEndRecordGame() {
	var endBtn = document.getElementById('end-record-game-btn');
	var confirmSection = document.getElementById('end-game-confirm');
	var confirmBtn = document.getElementById('confirm-end-game-btn');
	var cancelBtn = document.getElementById('cancel-end-game-btn');
	if (!endBtn || !confirmSection || !confirmBtn || !cancelBtn) return;

	function hasAnyLoggedStats() {
		return Object.keys(gameTrackingState.playerStatsByName).some(function (name) {
			var stats = gameTrackingState.playerStatsByName[name];
			return Object.keys(stats).some(function (key) { return (stats[key] || 0) !== 0; });
		});
	}

	function todayDateString() {
		var today = new Date();
		var month = today.getMonth() + 1;
		var day = today.getDate();
		return today.getFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
	}

	function buildPlayersPayload() {
		var players = [];
		Object.keys(gameTrackingState.playerStatsByName).forEach(function (name) {
			var s = gameTrackingState.playerStatsByName[name];
			var hasStat = Object.keys(s).some(function (key) { return (s[key] || 0) !== 0; });
			if (!hasStat) return;

			players.push({
				name: name,
				playerNumber: null,
				stats: {
					mp: null,
					points: (s.fgm || 0) * 2 + (s.tpm || 0) * 3 + (s.ftm || 0),
					fgm: s.fgm || 0,
					fga: s.fga || 0,
					tpm: s.tpm || 0,
					tpa: s.tpa || 0,
					ftm: s.ftm || 0,
					fta: s.fta || 0,
					off_rebounds: s.offRebounds || 0,
					def_rebounds: s.defRebounds || 0,
					rebounds: (s.offRebounds || 0) + (s.defRebounds || 0),
					assists: s.assists || 0,
					steals: s.steals || 0,
					blocks: s.blocks || 0,
					turnovers: s.turnovers || 0,
					fouls: s.fouls || 0,
				},
			});
		});
		return players;
	}

	endBtn.addEventListener('click', function () {
		var status = document.getElementById('stat-status');

		if (!gameTrackingState.teamName) {
			if (status) status.textContent = 'Add a team before ending/recording the game.';
			return;
		}
		if (!hasAnyLoggedStats()) {
			if (status) status.textContent = 'Log at least one stat before ending/recording the game.';
			return;
		}

		endBtn.hidden = true;
		confirmSection.hidden = false;
	});

	cancelBtn.addEventListener('click', function () {
		confirmSection.hidden = true;
		endBtn.hidden = false;
	});

	confirmBtn.addEventListener('click', function () {
		var status = document.getElementById('stat-status');
		confirmBtn.disabled = true;
		cancelBtn.disabled = true;
		if (status) status.textContent = 'Recording game…';

		fetch('/api/advanced-stats/record-game', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				gameDate: todayDateString(),
				opponent: gameTrackingState.teamName,
				location: null,
				players: buildPlayersPayload(),
			}),
		})
			.then(function (response) {
				return response.json().then(function (data) {
					return { ok: response.ok, data: data };
				});
			})
			.then(function (result) {
				confirmBtn.disabled = false;
				cancelBtn.disabled = false;

				if (!result.ok) {
					if (status) status.textContent = result.data.error || 'Something went wrong recording the game.';
					return;
				}

				clearGameFields();
				var clearedStatus = document.getElementById('stat-status');
				if (clearedStatus) clearedStatus.textContent = 'Game recorded! Select an athlete below to start a new game.';
			})
			.catch(function () {
				confirmBtn.disabled = false;
				cancelBtn.disabled = false;
				if (status) status.textContent = 'Something went wrong recording the game.';
			});
	});
}
