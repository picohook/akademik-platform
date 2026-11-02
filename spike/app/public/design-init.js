// Runs before the first paint so the catalogue never flashes in the wrong design. The choice is read from the
// device-wide key; library-designs.mjs switches to the signed-in reader's own choice once it knows who that is.
// A plain script on purpose: an inline one would be refused by the Content-Security-Policy.
(function () {
  var design = 'light';
  try {
    var saved = localStorage.getItem('libreadDesign');
    if (saved === 'classic' || saved === 'light' || saved === 'salon') design = saved;
  } catch (error) { /* storage can be blocked: the default design is used */ }
  document.documentElement.setAttribute('data-design', design);
})();
