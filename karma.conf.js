process.env.CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable';

/**
 * Конфиг Karma.
 *
 * Без явного конфига `ng test` на CI-раннере падает по двум причинам:
 *   1. Chrome в контейнере требует --no-sandbox;
 *   2. браузер по умолчанию не headless.
 * Поэтому launcher объявлен явно, а не унаследован из дефолта билдера.
 */
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular/build'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    jasmineConfig: { jasmineOpts: {}, random: true },
    client: {
      jasmine: { random: true },
      clearContext: true,
    },
    coverageReporter: {
      dir: require('path').join(__dirname, 'coverage'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadlessCI'],
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--headless=new',
        ],
      },
    },
    restartOnFileChange: false,
    singleRun: true,
  });
};
