const assert = require('node:assert/strict')

module.exports = async function ({ data, evaluate, button, field, waitFor, profile, frame }) {
  const dialog = 'document.querySelector("dialog[open]")'
  const select = async id => {
    await evaluate(`(() => { const select = document.querySelector('.profile-page select'); select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await frame()
  }
  const name = async () => evaluate('document.querySelector(".profile-page form input:not([name=profileTitle])")?.value')
  assert.equal((await data('getBaselineStatus', { profileId: profile.id })).value.status, 'DRAFT')
  await button('Confirm and freeze'); await button('Confirm', dialog)
  await waitFor(async () => (await data('getBaselineStatus', { profileId: profile.id })).value.status === 'READY', 'explicit baseline approval')
  const approved = (await data('getProfile', { id: profile.id })).value
  await field('Personal introduction', 'Working edits after approval')
  await evaluate('document.querySelector(".profile-page form").requestSubmit()')
  await waitFor(async () => (await data('getProfile', { id: profile.id })).value.introduction === 'Working edits after approval', 'working edit persists')
  await button('Duplicate'); await field('Profile title', 'Independent copy', dialog); await button('Confirm', dialog)
  let copy
  await waitFor(async () => { copy = (await data('listProfiles')).value.items.find(p => p.title === 'Independent copy'); return Boolean(copy) && await evaluate('document.querySelector(".profile-page select")?.value') === copy.id }, 'working duplicate selected')
  assert.equal(copy.introduction, 'Working edits after approval')
  assert.equal((await data('getBaselineStatus', { profileId: copy.id })).value.status, 'DRAFT')
  await field('Name', 'Unsaved other person'); await select(profile.id)
  await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'), 'profile switch unsaved guard')
  await button('Cancel', dialog); assert.equal(await name(), 'Unsaved other person')
  await select(profile.id); await button('Discard and switch', dialog)
  await waitFor(async () => await name() === approved.name, 'discard clears old editor')
  assert.equal((await data('getProfile', { id: copy.id })).value.name, approved.name)
  await button('Restore approved version'); await button('Confirm', dialog)
  await waitFor(async () => (await data('getProfile', { id: profile.id })).value.introduction === approved.introduction, 'restore approved content')
  await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'restore dialog closed')
  // Each newly selected PDF gets a fresh target; neither saved import nor baseline is reused.
  for (let index = 0; index < 2; index++) {
    assert.equal(await evaluate('[...document.querySelectorAll(".ui-checkbox")].find(label => label.textContent === "Append to current profile").querySelector("input").checked'), false)
    await button('Upload PDF and parse')
    await waitFor(() => evaluate('!!document.querySelector("[data-import-id]")'), 'new-profile PDF draft')
    await button('Save imported content')
    await waitFor(async () => (await data('listProfiles')).value.total === index + 3, 'new PDF creates independent profile')
    const selected = await evaluate('document.querySelector(".profile-page select").value')
    assert.notEqual(selected, profile.id); assert.notEqual(selected, copy.id)
    assert.equal((await data('getBaselineStatus', { profileId: selected })).value.status, 'DRAFT')
    await button('Discard import'); await button('Discard import', dialog)
    await waitFor(() => evaluate('!document.querySelector("dialog[open]")'), 'saved import session discarded')
    if (index === 1) await data('deleteProfile', { id: selected })
  }
  await select(profile.id)
  await waitFor(async () => await name() === approved.name, 'original profile reselected')
  console.log('Profile baseline UI verified: explicit freeze/restore, working duplicate, draft imports, fresh PDF targets and unsaved switching.')
}
