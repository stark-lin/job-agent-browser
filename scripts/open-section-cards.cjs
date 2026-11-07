module.exports = (evaluate, selector) => evaluate(`(() => {
  const targets = document.querySelectorAll(${JSON.stringify(selector)});
  if (!targets.length) throw new Error('Section card target is missing');
  for (const target of targets) {
    const cards = [];
    for (let card = target.closest('details.ui-section-card'); card; card = card.parentElement.closest('details.ui-section-card')) {
      cards.unshift(card);
    }
    for (const card of cards) {
      if (!card.open) card.querySelector(':scope > summary').click();
    }
  }
})()`)
