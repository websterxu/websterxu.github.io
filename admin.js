'use strict';
const byId = id => document.getElementById(id);
const endpoint = '/repos/websterxu/websterxu.github.io/contents/index.html';
const status = byId('status');
const login = byId('login');
const editor = byId('editor');
let token, source, sha;
let entries = [];

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
  return courses ? /<tr>[\s\S]*?<\/tr>/g : /<li class="publication">[\s\S]*?<\/li>/g;
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
    populateEntries();
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
editor.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = [...byId('fields').querySelectorAll('input, textarea')].map(field => field.value.trim());
  if (fields.some(value => !value)) {
    status.textContent = 'Complete every field.';
    return;
  }
  byId('publish').disabled = true;
  byId('logout').disabled = true;
  try {
    const { section, list, courses } = sectionMarkup();
    const selected = byId('entry').value;
    const safe = fields.map(escapeText);
    const row = courses ? '<tr>' + safe.map(value => '<td>' + value + '</td>').join('') + '</tr>'
      : '<li class="publication">' + safe[0] + '</li>';
    let index = 0;
    const updated = selected === ''
      ? list.replace(/<\/(tbody|ol)>$/, closing => row + closing)
      : list.replace(entryPattern(courses), previous => String(index++) === selected ? row : previous);
    const html = source.replace(section, () => section.replace(list, () => updated));
    if (html === source) {
      status.textContent = 'There are no changes to publish.';
      return;
    }
    const bytes = new TextEncoder().encode(html);
    const content = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const result = await github(endpoint, {
      method: 'PUT',
      body: JSON.stringify({ message: 'Update academic website content', content, sha, branch: 'main' })
    });
    source = html;
    sha = result.content.sha;
    populateEntries();
    status.textContent = 'Committed to GitHub. The public website will update after GitHub Pages deploys.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    byId('publish').disabled = false;
    byId('logout').disabled = false;
  }
});
