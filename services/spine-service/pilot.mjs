import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorConfig, createHiddenPrompt } from './pilot-input.mjs';
import { createCredentialStore, readOperatorCredentials } from './pilot-credentials.mjs';

async function client() {
  if (!process.send) throw new Error('PILOT_CLIENT_REQUIRED');
  const { run } = await import('../../src/main.mjs');
  const [, , , appRoot, dataDir, port] = process.argv;
  const app = await run({ appRoot, dataDir, port: Number(port) });
  if (app.alreadyRunning) {
    await app.close();
    throw new Error('PORT_IN_USE');
  }
  let closing;
  const close = () =>
    (closing ??= app.close().finally(() => {
      if (process.connected) process.disconnect();
    }));
  process.on('message', (message) => {
    if (message?.type === 'stop')
      close().catch(() => {
        process.exitCode = 1;
      });
  });
  process.once('disconnect', () =>
    close().catch(() => {
      process.exitCode = 1;
    }),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () =>
      close().catch(() => {
        process.exitCode = 1;
      }),
    );
  process.send({ type: 'ready', origin: app.origin });
}

async function operator() {
  if (!process.argv.includes('--free-confirmed')) {
    console.error('Wymagane potwierdzenie planu Workers Free.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA))
    throw new Error('PILOT_LOCAL_DATA');
  const checking = process.argv.includes('--check-access');
  const rememberCredentials = process.argv.includes('--remember-credentials');
  const configureCredentials = process.argv.includes('--configure-credentials');
  const forgetCredentials = process.argv.includes('--forget-credentials');
  const qualitySeries = process.argv.includes('--quality-covers-9b');
  const qualityCleanup = process.argv.includes('--quality-diuna-9b-cleanup');
  const qualityAutoReference = process.argv.includes('--quality-diuna-9b-auto-reference');
  const resumeFramedQuota = process.argv.includes('--resume-confirmed-framed-quota');
  const qualityFramed = process.argv.includes('--quality-diuna-9b-framed') || resumeFramedQuota;
  const qualityStyle = process.argv.includes('--quality-diuna-9b-style');
  const qualityTextless = process.argv.includes('--quality-diuna-9b-textless');
  const qualitySmooth =
    process.argv.includes('--quality-diuna-9b-smooth') ||
    qualityTextless ||
    qualitySeries ||
    qualityAutoReference ||
    qualityFramed;
  const quality9b =
    process.argv.includes('--quality-diuna-9b') || qualityStyle || qualitySmooth || qualityCleanup;
  const quality = process.argv.includes('--quality-diuna') || quality9b;
  if (
    (checking && quality) ||
    ((configureCredentials || forgetCredentials) && (checking || quality || rememberCredentials)) ||
    (configureCredentials && forgetCredentials) ||
    [
      '--quality-diuna',
      '--quality-diuna-9b',
      '--quality-diuna-9b-style',
      '--quality-diuna-9b-smooth',
      '--quality-diuna-9b-textless',
      '--quality-covers-9b',
      '--quality-diuna-9b-cleanup',
      '--quality-diuna-9b-auto-reference',
      '--quality-diuna-9b-framed',
      '--resume-confirmed-framed-quota',
    ].filter((flag) => process.argv.includes(flag)).length > 1
  )
    throw new Error('SERVICE_CONFIG');
  const credentialStore = createCredentialStore({ localAppData: process.env.LOCALAPPDATA });
  const promptFactory = () => {
    console.log('Dane wpisujesz lokalnie. Znaki nie beda wyswietlane. Ctrl+C konczy wpisywanie.\n');
    return createHiddenPrompt();
  };
  if (forgetCredentials) {
    await credentialStore.forget();
    console.log('Usunieto zapisane dane Cloudflare. Dziennik i limit pozostaja zachowane.');
    return;
  }
  if (configureCredentials) {
    await readOperatorCredentials({
      store: credentialStore,
      remember: true,
      replace: true,
      promptFactory,
    });
    console.log(
      'Zapisano dane Cloudflare zaszyfrowane dla Twojego konta Windows. Nie uruchomiono generacji.',
    );
    return;
  }
  const profile = qualityCleanup
    ? 'cover-clean-v1-9b'
    : qualityFramed
      ? 'framed-v5-9b'
      : qualitySmooth
        ? 'smooth-v4-9b'
        : qualityStyle
          ? 'style-v3-9b'
          : quality9b
            ? 'quality-v2-9b'
            : quality
              ? 'quality-v2'
              : 'default';
  const appRoot = path.resolve(import.meta.dirname, '../..'),
    dataDir = path.join(process.env.LOCALAPPDATA, 'BiblioteczkaSpinePilot/service');
  let qualityInput, materialInput, seriesInput;
  if (quality) {
    const { assertQualityProbeReady } = await import('./quality-probe.mjs');
    await assertQualityProbeReady({ dataDir });
    if (qualitySeries) {
      const { readQualitySamples } = await import('./quality-series.mjs');
      seriesInput = {
        dataDir,
        outputDir: path.join(appRoot, 'output/execution/spine-variety-9b-20261019'),
        samples: await readQualitySamples({ appRoot }),
      };
    } else {
      if (qualityStyle) {
        const { readMaterialReference } = await import('./material-reference.mjs');
        materialInput = readMaterialReference();
      }
      const { readQualityCover } = await import('./quality-cover.mjs');
      qualityInput = {
        dataDir,
        outputDir: path.join(
          appRoot,
          qualityFramed
            ? 'output/execution/spine-framed-9b-20261019'
            : qualityAutoReference
              ? 'output/execution/spine-auto-reference-9b-20261019'
              : qualityCleanup
                ? 'output/execution/spine-cover-cleanup-9b-20261019'
                : qualityTextless
                  ? 'output/execution/spine-textless-9b-20261019'
                  : qualitySmooth
                    ? 'output/execution/spine-smooth-9b-20261019'
                    : qualityStyle
                      ? 'output/execution/spine-style-9b-20261019'
                      : quality9b
                        ? 'output/execution/spine-quality-9b-20261019'
                        : 'output/execution/spine-quality-20261017',
        ),
        ...(await readQualityCover({
          appRoot,
          textless: qualityTextless,
          autoCleaned: qualityAutoReference || qualityFramed,
        })),
      };
    }
  }
  if (resumeFramedQuota) {
    const { recoverFramedQuota } = await import('./quota-recovery.mjs');
    const result = await recoverFramedQuota({
      dataDir,
      outputDir: qualityInput.outputDir,
      confirmed: true,
    });
    if (result.blocked) {
      const local = new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'Europe/Warsaw',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(result.notBefore));
      console.log(
        'Pula nie zostala jeszcze odnowiona. Uruchom ten sam plik po ' +
          local +
          ' (czas w Polsce).',
      );
      console.log('Nie odczytano tokenu, nie zmieniono dziennika i nie wywolano Cloudflare.');
      return;
    }
    console.log('Potwierdzono odmowe limitu dla tej proby. Zachowano kopie dziennika i liczniki.');
  }
  console.log(
    qualityCleanup
      ? 'Biblioteczka - jedna proba usuniecia napisow z okladki Diuny przez 9B (Workers Free).'
      : qualitySeries
        ? 'Biblioteczka - dwie nowe probki gladkiego 9B: Rok 1984 i Quo vadis (Workers Free).'
        : qualityTextless
          ? 'Biblioteczka - jedna proba gladkiego 9B z referencja bez napisow (Workers Free).'
          : qualitySmooth
            ? 'Biblioteczka - jedna proba gladkiego 9B w proporcjach grzbietu 1:5 (Workers Free).'
            : qualityStyle
              ? 'Biblioteczka - jedna proba 9B z probka materialu i kolorami okladki (Workers Free).'
              : quality9b
                ? 'Biblioteczka - pojedyncza proba modelu 9B dla Diuny (Workers Free).'
                : quality
                  ? 'Biblioteczka - pojedyncza proba nowego opisu dla Diuny (Workers Free).'
                  : checking
                    ? 'Biblioteczka - sprawdzenie polaczenia z Cloudflare (tylko odczyt).'
                    : 'Biblioteczka - proba na potwierdzonym planie Workers Free.',
  );
  if (qualityAutoReference || qualityFramed)
    console.log(
      'Wejscie: gotowa okladka automatycznie oczyszczona przez 9B. Maksymalnie jedna proba grzbietu; bez ponownego czyszczenia.',
    );
  if (qualityFramed)
    console.log('Nowy kadr: pelniejszy centralny motyw, bez zblizenia; spokojne miejsce na tytul.');
  let {
    accountId: id,
    apiToken: token,
    source,
    saved,
  } = await readOperatorCredentials({
    store: credentialStore,
    remember: rememberCredentials,
    promptFactory,
  });
  if (source === 'stored')
    console.log('Uzywam danych Cloudflare zapisanych dla Twojego konta Windows.');
  else if (saved) console.log('Zapisano dane Cloudflare zaszyfrowane dla Twojego konta Windows.');
  if (quality9b) {
    const { checkCloudflareAccess } = await import('./access-check.mjs');
    const report = await checkCloudflareAccess({ accountId: id, apiToken: token, profile });
    console.log(
      'MODEL_9B_W_KATALOGU: ' +
        (report.workersAI.modelFound === true
          ? 'TAK'
          : report.workersAI.modelFound === false
            ? 'NIE'
            : 'NIEPOTWIERDZONY'),
    );
    if (
      report.token.status !== 'ACTIVE' ||
      report.workersAI.status !== 'OK' ||
      report.workersAI.modelFound !== true
    ) {
      token = null;
      console.log('Nie potwierdzono dostepu do 9B. Nie rozpoczeto generacji.');
      process.exitCode = 1;
      return;
    }
  }
  if (checking) {
    const { checkCloudflareAccess } = await import('./access-check.mjs');
    const report = await checkCloudflareAccess({ accountId: id, apiToken: token });
    token = null;
    console.log('\nBEZPIECZNY WYNIK DIAGNOSTYKI:');
    for (const [label, result] of Object.entries(report))
      console.log(
        label.toUpperCase() +
          ': HTTP ' +
          (result.http ?? 'BRAK') +
          '; ' +
          result.status +
          '; kody: ' +
          (result.codes.join(', ') || 'brak'),
      );
    console.log(
      'MODEL_W_KATALOGU: ' +
        (report.workersAI.modelFound === true
          ? 'TAK'
          : report.workersAI.modelFound === false
            ? 'NIE'
            : 'NIEPOTWIERDZONY'),
    );
    console.log(
      'To test odczytu. Nie sprawdza Workers AI Edit ani uruchomienia modelu. Nie generuje obrazow ani nie zmienia kolejki.',
    );
    return;
  }
  const { createCloudflareProvider } = await import('./cloudflare-provider.mjs');
  const provider = createCloudflareProvider({
    ...operatorConfig({ accountId: id, apiToken: token, freeConfirmed: true }),
    profile,
    styleReferenceBytes: materialInput?.bytes,
  });
  token = null;
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  if (qualitySeries) {
    console.log(
      '\nMaksymalnie dwie nowe generacje, kolejno. Diuna pozostaje gotowa probka kontrolna. Seria zatrzyma sie przy braku limitu, odmowie lub niepewnym wyniku.',
    );
    const { runQualitySeries } = await import('./quality-series.mjs');
    const result = await runQualitySeries({ ...seriesInput, provider, signal: controller.signal });
    for (const sample of result.results)
      console.log(
        sample.title +
          ': ' +
          sample.state +
          '; nowe proby: ' +
          sample.requestsStarted +
          '; dzisiaj: ' +
          sample.dayAttempts +
          '/10',
      );
    console.log(
      'SERIA_OKLADEK: ' + result.state + '; nowe proby lacznie: ' + result.requestsStarted,
    );
    console.log('Wyniki zapisane w osobnym katalogu. Napisz w rozmowie: gotowe.');
    return;
  }
  if (quality) {
    console.log(
      qualityCleanup
        ? '\nUsuwam tylko napisy z oryginalnej okladki: 512 x 768. Maksymalnie jedna proba, bez generacji grzbietu i bez zmiany kolekcji.'
        : qualityTextless
          ? '\nZmieniam tylko referencje na ilustracje bez napisow. Ten sam model, opis i rozmiar 320 x 1600; osobny wynik. Kolekcja pozostaje bez zmian.'
          : qualitySmooth
            ? '\nSprawdzam gladki grzbiet 320 x 1600, bez referencji plotna. Kolekcja pozostaje bez zmian.'
            : qualityStyle
              ? '\nSprawdzam 9B z dodatkowa referencja materialu i nowym opisem. To osobna proba stylu. Kolekcja pozostaje bez zmian.'
              : quality9b
                ? '\nSprawdzam 9B na tej samej okladce i opisie co 4B. Kolekcja pozostaje bez zmian.'
                : '\nSprawdzam nowy opis na jednej okladce. Kolekcja pozostaje bez zmian.',
    );
    const { runQualityProbe } = await import('./quality-probe.mjs');
    const result = await runQualityProbe({ ...qualityInput, provider, signal: controller.signal });
    console.log(
      'JAKOSC_DIUNA: ' +
        result.state +
        '; nowe proby: ' +
        result.requestsStarted +
        '; dzisiaj: ' +
        result.dayAttempts +
        '/10',
    );
    if (result.diagnostic)
      console.log(
        'ODPOWIEDZ: HTTP ' +
          (result.diagnostic.http ?? 'BRAK') +
          '; kody: ' +
          (result.diagnostic.codes.join(', ') || 'brak'),
      );
    if (result.file)
      console.log('Obraz zapisany do osobnego porownania. Napisz w rozmowie: gotowe.');
    else
      console.log(
        'Nie ma potwierdzonego obrazu. Zglos powyzszy status; program nie ponawia generacji automatycznie.',
      );
    return;
  }
  const { startPilot } = await import('./pilot-runtime.mjs');
  const pilot = await startPilot({
    appRoot: path.resolve(import.meta.dirname, '../..'),
    dataRoot: path.join(process.env.LOCALAPPDATA, 'BiblioteczkaSpinePilot'),
    provider,
    signal: controller.signal,
  });
  console.log('\nGenerator i panel proby sa uruchomione.');
  console.log(pilot.origin + '/manager');
  console.log('Pozostaw to okno otwarte. Zamykanie: Ctrl+C.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isClient = process.argv[2] === '--client';
  (isClient ? client() : operator()).catch((error) => {
    if (isClient && process.connected) {
      process.send({ type: 'failed' });
      process.disconnect();
    } else {
      const messages = {
        PILOT_CANCELLED: 'Przerwano wpisywanie.',
        PILOT_TERMINAL_REQUIRED: 'Uruchom plik Uruchom-probe-Free.cmd w zwyklym oknie Windows.',
        PORT_IN_USE:
          'Port proby zajmuje inny program lub panel nie zakonczyl pracy. Nie zamknieto obcej instalacji.',
        DATA_IN_USE: 'Dane proby sa juz otwarte. Zatrzymaj poprzedni generator przez Ctrl+C.',
        PILOT_CLIENT_FAILED: 'Nie udalo sie uruchomic panelu proby.',
        PILOT_LOCAL_DATA: 'Brak lokalnego katalogu danych Windows.',
        SERVICE_CONFIG: 'Nieprawidlowa konfiguracja lokalna. Uruchom ponownie plik proby.',
        PILOT_CREDENTIALS_READ:
          'Nie mozna odczytac zapisanych danych Cloudflare. Uruchom Zmien-dane-Cloudflare.cmd, aby zapisac je ponownie.',
        PILOT_CREDENTIALS_WRITE:
          'Nie udalo sie zaszyfrowac lub zapisac danych Cloudflare. Nie zapisano ich jawnym tekstem.',
        PILOT_CREDENTIALS_FORGET:
          'Nie udalo sie usunac zapisanych danych Cloudflare. Dziennik pozostaje zachowany.',
        QUALITY_NO_PILOT:
          'Brak dziennika dotychczasowej proby. Nie rozpoczeto nowego limitu ani generacji.',
        QUALITY_COVER_CHANGED:
          'Okladka Diuny jest inna niz zatwierdzona. Nie rozpoczeto generacji.',
        QUALITY_REFERENCE_CHANGED:
          'Referencja bez napisow jest niedostepna lub zmieniona. Nie rozpoczeto generacji.',
        QUALITY_MATERIAL_CHANGED:
          'Probka materialu jest niedostepna lub zmieniona. Nie rozpoczeto generacji.',
        QUALITY_BACKUP: 'Nie udalo sie potwierdzic kopii dziennika. Nie rozpoczeto generacji.',
        QUALITY_OUTPUT_CONFLICT:
          'Osobny plik porownania zawiera juz inny obraz. Wynik zachowano w usludze; zglos ten komunikat.',
        QUALITY_RECOVERY_CONFIRMATION:
          'Wznowienie wymaga potwierdzenia wyczerpania darmowej puli dla tej proby.',
        QUALITY_RECOVERY_SCOPE:
          'To nie jest zatwierdzona proba z potwierdzona odmowa limitu 4006. Nie wznowiono jej.',
        QUALITY_RECOVERY_CONFLICT:
          'Dziennik lub kopia wznowienia rozni sie od oczekiwanej. Nie wykonano kolejnej proby.',
      };
      console.error(
        messages[error.code ?? error.message] ??
          'Nie udalo sie uruchomic proby. Zglos ten komunikat.',
      );
    }
    process.exitCode = 1;
  });
}
