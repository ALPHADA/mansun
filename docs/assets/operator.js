(function () {
  function init() {
    var hamburger = document.querySelector('.hamburger');
    var sidebar = document.querySelector('.sidebar');
    var backdrop = document.querySelector('.sidebar-backdrop');
    if (!hamburger || !sidebar || !backdrop) return;

    function open() {
      sidebar.classList.add('open');
      backdrop.classList.add('show');
    }
    function close() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    }
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      sidebar.classList.contains('open') ? close() : open();
    });
    backdrop.addEventListener('click', close);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
