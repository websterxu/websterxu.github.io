'use strict';
const byId = id => document.getElementById(id);
const endpoint = '/repos/websterxu/websterxu.github.io/contents/index.html';
const status = byId('status');
const login = byId('login');
const editor = byId('editor');
let token, source, sha;
let entries = [];
let busy = false;
const newSection = byId("new-section");

async function github(path, options = {}) {
  const response = await fetch('https://api.github.com' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    redirect: 'error'
  });
  if (!response.ok) {
    if (response.status === 409 || response.status === 422) {
      throw new Error('GitHub rejected the update. Reload the editor to check for newer changes.');
    }
    throw new Error('GitHub returned ' + response.status + '. Check the token and its repository permissions.');
  }
  return response.json();
}

async function loadSource() {
  const file = await github(endpoint + '?ref=main');
  source = new TextDecoder().decode(Uint8Array.from(atob(file.content), ch => ch.charCodeAt(0)));
  sha = file.sha;
}

function sectionMarkup() {
  const id = byId('section').value;
  const section = source.match(new RegExp('<section id="' + id + '"[^>]*>[\\s\\S]*?</section>'));
  if (!section) throw new Error('The website section could not be found.');
  const courses = id === 'teaching';
  const list = section[0].match(courses ? /<tbody>[\s\S]*?<\/tbody>/ : /<ol\b[^>]*>[\s\S]*?<\/ol>/);
  if (!list) throw new Error('The entry list could not be found.');
  return { section: section[0], list: list[0], courses };
}

function entryPattern(courses) {
  return courses ? /<tr>[\s\S]*?<\/tr>/g : /<li class="(?:publication|owner-entry)">[\s\S]*?<\/li>/g;
}

function decode(markup) {
  return new DOMParser().parseFromString(markup, 'text/html').body.textContent.trim();
}

function populateEntries() {
  const { list, courses } = sectionMarkup();
  entries = Array.from(list.matchAll(entryPattern(courses)), match => courses
    ? Array.from(match[0].matchAll(/<td>([\s\S]*?)<\/td>/g), cell => decode(cell[1]))
    : [decode(match[0])]);
  byId('entry').replaceChildren(new Option('Add a new entry', ''));
  entries.forEach((entry, index) => byId('entry').add(new Option(entry.join(' · ').slice(0, 150), index)));
  populateFields();
}

function populateFields() {
  byId("delete").disabled = byId("entry").value === "";
  const values = entries[byId('entry').value] || [];
  const labels = byId('section').value === 'teaching' ? ['Course code', 'Course title', 'CV dates'] : ['Full citation'];
  byId('fields').replaceChildren(...labels.map((caption, index) => {
    const label = document.createElement('label');
    const field = document.createElement(labels.length === 1 ? 'textarea' : 'input');
    field.required = true;
    field.maxLength = labels.length === 1 ? 3000 : 250;
    field.value = values[index] || '';
    label.append(caption, field);
    return label;
  }));
}

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  login.querySelector('button').disabled = true;
  token = byId('token').value.trim();
  byId('token').value = '';
  try {
    const user = await github('/user');
    if (user.id !== 22850635) throw new Error('This editor is reserved for the website owner.');
    await loadSource();
    populateSections();
    populateEntries();
    newSection.hidden = false;
    login.hidden = true;
    editor.hidden = false;
    status.textContent = 'Editor unlocked.';
  } catch (error) {
    token = undefined;
    status.textContent = error.message;
  } finally {
    login.querySelector('button').disabled = false;
  }
});

byId('section').addEventListener('change', populateEntries);
byId('entry').addEventListener('change', populateFields);
byId('logout').addEventListener('click', () => location.reload());
function populateSections() {
  const select = byId('section');
  const selected = select.value;
  const page = new DOMParser().parseFromString(source, 'text/html');
  const custom = [...page.querySelectorAll('section[data-owner-section]')];
  select.replaceChildren(new Option('Publications', 'publications'), new Option('Teaching courses', 'teaching'),
    ...custom.map(section => new Option(section.querySelector('h2').textContent, section.id)));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

async function publish(html, message, sectionId = byId('section').value) {
  if (busy) return;
  if (html === source) {
    status.textContent = 'There are no changes to publish.';
    return;
  }
  busy = true;
  const controls = [...document.querySelectorAll('#editor button, #editor select, #new-section button')];
  controls.forEach(control => { control.disabled = true; });
  status.textContent = 'Publishing…';
  try {
    const bytes = new TextEncoder().encode(html);
    const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const result = await github(endpoint, {
      method: 'PUT',
      body: JSON.stringify({ message, content, sha, branch: 'main' })
    });
    source = html;
    sha = result.content.sha;
    populateSections();
    byId('section').value = sectionId;
    populateEntries();
    status.textContent = 'Committed to GitHub. The public website will update after GitHub Pages deploys.';
    return true;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
    controls.forEach(control => { control.disabled = false; });
    byId('delete').disabled = byId('entry').value === '';
  }
}

function changeEntry(row) {
  const { section, list, courses } = sectionMarkup();
  const selected = byId('entry').value;
  let index = 0;
  const updated = selected === ''
    ? list.replace(/<\/(tbody|ol)>$/, closing => row + closing)
    : list.replace(entryPattern(courses), previous => String(index++) === selected ? row : previous);
  return source.replace(section, () => section.replace(list, () => updated));
}

editor.addEventListener('submit', event => {
  event.preventDefault();
  const fields = [...byId('fields').querySelectorAll('input, textarea')].map(field => field.value.trim());
  if (fields.some(value => !value)) {
    status.textContent = 'Complete every field.';
    return;
  }
  const safe = fields.map(escapeText);
  const row = byId('section').value === 'teaching'
    ? '<tr>' + safe.map(value => '<td>' + value + '</td>').join('') + '</tr>'
    : '<li class="' + (byId('section').value === 'publications' ? 'publication' : 'owner-entry') + '">' + safe[0] + '</li>';
  publish(changeEntry(row), 'Update academic website content');
});

byId('delete').addEventListener('click', () => {
  const selected = byId('entry').value;
  if (selected === '' || busy) return;
  if (confirm('Delete this entry from the public website?\n\n' + entries[selected].join(' · '))) {
    publish(changeEntry(''), 'Delete academic website entry');
  }
});

newSection.addEventListener('submit', async event => {
  event.preventDefault();
  const title = byId('new-title').value.trim();
  const first = byId('new-entry').value.trim();
  if (!title || !first) {
    status.textContent = 'Enter a section title and first entry.';
    return;
  }
  const page = new DOMParser().parseFromString(source, 'text/html');
  if ([...page.querySelectorAll('main section h1, main section h2')].some(heading =>
    heading.textContent.trim().toLowerCase() === title.toLowerCase())) {
    status.textContent = 'A section already uses this title.';
    return;
  }
  if (!source.includes('</nav>') || !source.includes('</main>')) {
    status.textContent = 'The website navigation or main content could not be found.';
    return;
  }
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  let id = 'custom-' + slug;
  for (let suffix = 2; page.getElementById(id); suffix++) id = 'custom-' + slug + '-' + suffix;
  const name = escapeText(title);
  const section = '<section id="' + id + '" class="section" data-owner-section>'
    + '<div class="section-title"><h2>' + name + '</h2></div>'
    + '<div class="section-body"><ol><li class="owner-entry">' + escapeText(first)
    + '</li></ol></div></section>';
  const html = source.replace('</nav>', () => '<a href="#' + id + '">' + name + '</a></nav>')
    .replace('</main>', () => section + '</main>');
  if (await publish(html, 'Create academic website section', id)) newSection.reset();
});
