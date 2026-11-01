import {createSignal, JSX, onCleanup, onMount} from 'solid-js';

import Button from '@components/buttonTsx';
import confirmationPopup from '@components/confirmationPopup';
import CountryInputField from '@components/countryInputField';
import InputField from '@components/inputField';
import LanguageChangeButton from '@components/languageChangeButton';
import PasskeyLoginButton from '@components/passkeyLoginButton';
import MediaHeader from '@components/mediaHeader';
import TelInputField from '@components/telInputField';
import IS_TOUCH_SUPPORTED from '@environment/touchSupport';
import classNames from '@helpers/string/classNames';
import {getServerIconUrl} from '@lib/owpengram/identity';
import {encodeEmailPhone} from '@lib/owpengram/emailSignupPhone';
import {
  fetchLoginAppConfig,
  isPhoneFallbackChosen,
  setPhoneFallbackChosen
} from '@lib/owpengram/emailSignupSetting';
import cancelEvent from '@helpers/dom/cancelEvent';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd';
import replaceContent from '@helpers/dom/replaceContent';
import formatDuration from '@helpers/formatDuration';
import {HelpCountry, HelpCountryCode} from '@layer';
import {getFloodWaitTime} from '@appManagers/utils/getFloodWaitTime';
import I18n, {i18n} from '@lib/langPack';
import lottieLoader from '@lib/lottie/lottieLoader';
import AccountController from '@lib/accounts/accountController';
import commonStateStorage from '@lib/commonStateStorage';
import {wrapFormattedDuration} from '@components/wrappers/wrapDuration';
import {TrueDcId} from '@types';

import AuthCard from '@/pages/AuthCard';
import AuthCardError from '@/pages/AuthCardError';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import {continueLogin} from '@/pages/continueLogin';
import styles from '@/pages/authFlow.module.scss';
import {preloadTrackingMonkey} from '@components/monkeys/tracking';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signIn'}>;

/**
 * Card variant of `pageSignIn`. Country picker + tel input → `auth.sendCode` →
 * branches to authCode (default), pageIm (rare authorization-on-send case),
 * password (passkey path). Also exposes a QR-login button and the passkey
 * button. On mount kicks off `tryAgain()` — a DC pre-warming cascade — that's
 * cancelled on unmount via a local `cancelled` flag.
 *
 * A server with email sign-up (`email_signup_enabled` in its app config) has no
 * SMS, so there the card asks for an email address instead, which goes out as a
 * synthetic phone number (see @lib/owpengram/emailSignupPhone). Phone sign-in
 * stays one tap away.
 *
 * A server with `login_email_enabled` allows logging in with an email address
 * for existing accounts (in addition to phone). The card shows a "Log in by Email"
 * button to switch modes.
 *
 * A server with `login_email_require_setup` requires a login email to be set up
 * before signing in. The server will return `auth.sentCodeTypeSetUpEmailRequired`
 * which routes to the emailSetup cards.
 */
export default function SignInCard(_props: {spec: Spec}) {
  const serverIconUrl = getServerIconUrl();
  const {accountNumber, managers, navigate, toIm} = useAuthFlow();

  let cancelled = false;

  /* ---------- state ---------- */

  const [submitting, setSubmitting] = createSignal(false);
  const [hasValidInput, setHasValidInput] = createSignal(false);
  const [nextContent, setNextContent] = createSignal<JSX.Element>(i18n('Login.Next'));
  // a whole sentence with a duration: too long for the field's floating label, so it gets a line under it
  const [floodError, setFloodError] = createSignal<JSX.Element>();

  /* ---------- inputs ---------- */

  let lastCountrySelected: HelpCountry | undefined;
  let lastCountryCodeSelected: HelpCountryCode | undefined;
  // whether the phone field holds a number worth sending, kept apart from
  // `hasValidInput` because that follows whichever field is on screen
  let phoneValid = false;
  // True while we're mirroring a phone-driven country detection into the country
  // selector. In that case the phone field is the source of truth and must NOT be
  // reset to the bare '+code' (that would wipe a just-typed/pasted national number).
  let overriding = false;

  const countryInputField = new CountryInputField({
    onCountryChange: (country, code) => {
      lastCountrySelected = country;
      lastCountryCodeSelected = code;

      if(!code || overriding) return;

      telInputField.value = telInputField.lastValue = '+' + code.country_code;
      setTimeout(() => {
        telEl.focus();
        placeCaretAtEnd(telEl, true);
      }, 0);
    }
  });

  const telInputField = new TelInputField({
    onInput: (formatted) => {
      lottieLoader.loadLottieWorkers();

      const {country, code} = formatted || {};
      const countryName = country ? country.name || country.default_name : '';
      if(countryName !== countryInputField.value && (
        !lastCountrySelected ||
          !country ||
          !code || (
          lastCountrySelected !== country &&
            lastCountryCodeSelected.country_code !== code.country_code
        )
      )) {
        overriding = true;
        countryInputField.override(country, code, countryName);
        overriding = false;
      }

      phoneValid = !!(country || (telInputField.value.length - 1) > 1);
      if(!emailMode()) setHasValidInput(phoneValid);
      setFloodError();
    }
  });

  const telEl = telInputField.input;
  telEl.setAttribute('role', 'textbox');
  telEl.setAttribute('aria-multiline', 'false');
  telEl.addEventListener('keypress', (e) => {
    if(hasValidInput() && !submitting() && e.key === 'Enter') {
      return onSubmit();
    }
  });

  /* ---------- email sign-up / login ---------- */

  // Same as the desktop client: the card starts on the phone form, and when the
  // server's app config says email sign-up is on (and the person has not chosen
  // the phone fallback) it is replaced by the email form. Nothing is remembered
  // between visits -- what the server says now is what counts.
  const [emailSignup, setEmailSignup] = createSignal(false);
  const [loginEmailEnabled, setLoginEmailEnabled] = createSignal(false);
  const [emailMode, setEmailMode] = createSignal(false);

  // true if either email signup or email login is enabled
  const emailAvailable = () => emailSignup() || loginEmailEnabled();

  const emailField = new InputField({
    label: 'Login.EmailLabel',
    name: 'email',
    plainText: true
  });

  const emailEl = emailField.input;
  emailEl.setAttribute('role', 'textbox');
  emailEl.setAttribute('aria-multiline', 'false');
  emailEl.setAttribute('autocapitalize', 'off');
  emailEl.setAttribute('spellcheck', 'false');
  emailEl.inputMode = 'email';
  if(emailEl instanceof HTMLInputElement) {
    emailEl.type = 'email';
    emailEl.autocomplete = 'email';
  }

  const isEmailValid = () => encodeEmailPhone(emailField.value) !== undefined;

  emailEl.addEventListener('input', () => {
    emailEl.classList.remove('error');
    emailField.setLabel();
    setHasValidInput(isEmailValid());
  });
  emailEl.addEventListener('keypress', (e) => {
    if(hasValidInput() && !submitting() && e.key === 'Enter') {
      return onSubmit();
    }
  });

  /** The field in use, and whether what it holds can be sent. */
  const activeInput = () => emailMode() ? emailEl : telEl;

  function setLoginMethod(email: boolean) {
    setEmailMode(email);
    setHasValidInput(email ? isEmailValid() : phoneValid);
    if(!IS_TOUCH_SUPPORTED) {
      focusWhenSettled(activeInput(), () => !cancelled);
    }
  }

  async function switchLoginMethod() {
    const toEmail = !emailMode();
    // A server with email sign-up sends no SMS: logging in by phone only works for
    // an account made before email sign-up was turned on, and still ends with an
    // email being linked. Say so before letting anyone go that way, as the desktop
    // client does.
    if(!toEmail && emailSignup()) {
      try {
        await confirmationPopup({
          titleLangKey: 'Login.PhoneFallback.Title',
          descriptionLangKey: 'Login.PhoneFallback.Text',
          button: {langKey: 'Login.PhoneFallback.Confirm'}
        });
      } catch{
        return;
      }
    }

    setPhoneFallbackChosen(!toEmail);
    setLoginMethod(toEmail);
  }

  /* ---------- submit ---------- */

  function onSubmit(e?: Event) {
    if(e) cancelEvent(e);

    setSubmitting(true);
    setFloodError();
    setNextContent(
      <>
        {i18n('PleaseWait')}
        <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
          <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
        </svg>
      </>
    );

    // an email address is sent as a synthetic phone number the server can decode
    const phone_number = emailMode() ? encodeEmailPhone(emailField.value) : telInputField.value;
    // * the code card's sticker is fetched alongside the code itself, not when that card mounts: by
    // * then the card is already open, and the monkey turns up in it a moment later
    preloadTrackingMonkey().catch(() => {});
    managers.appAccountManager.sendCode(phone_number).then((code) => {
      // the very first send has no previous `phone_code_hash` to sign up with
      return continueLogin(code, {managers, navigate, toIm, phone_number});
    }).catch((err: ApiError) => {
      setSubmitting(false);

      switch(err.type) {
        case 'PHONE_NUMBER_INVALID':
          if(emailMode()) {
            emailField.setError('Login.EmailLabelInvalid');
          } else {
            telInputField.setError();
            replaceContent(telInputField.label, i18n('Login.PhoneLabelInvalid'));
            telEl.classList.add('error');
          }
          setNextContent(i18n('Login.Next'));
          break;
        default: {
          console.error('auth.sendCode error:', err);
          const floodWait = getFloodWaitTime(err);
          if(floodWait.hasWaitTime) {
            telInputField.setError();
            setFloodError(i18n('Login.Code.TooManyAttempts', [wrapFormattedDuration(formatDuration(floodWait.waitTime))]));
            setNextContent(i18n('Login.Next'));
          } else {
            setNextContent(err.type);
          }
          break;
        }
      }
    });
  }

  /* ---------- DC pre-warm cascade ---------- */

  function tryAgain() {
    managers.apiManager.getNearestDc().then((nearestDcResult) => {
      if(cancelled) return nearestDcResult;

      const langPack = commonStateStorage.getFromCache('langPack');
      if(langPack && !langPack.countries?.hash) {
        I18n.getLangPackAndApply(langPack.lang_code).then(() => {
          if(!cancelled) telInputField.simulateInputEvent();
        });
      }

      // Empty rather than [1..5]: owpengram-server is one machine answering for
      // every DC id, so "pre-warming the other DCs" would open extra networkers
      // to the same place and, worse, run a second key exchange per id against
      // it while the login code request is still in flight.
      const dcs = new Set<number>();
      const done: number[] = [nearestDcResult.this_dc];

      let promise: Promise<any>;
      if(nearestDcResult.nearest_dc !== nearestDcResult.this_dc) {
        promise = managers.apiManager.getNetworkerVoid(nearestDcResult.nearest_dc).then(() => {
          done.push(nearestDcResult.nearest_dc);
        });
      }

      (promise || Promise.resolve()).then(() => {
        if(cancelled) return;

        done.forEach((dcId) => dcs.delete(dcId));

        const _dcs = [...dcs];
        const g = async(): Promise<void> => {
          if(cancelled) return;
          const dcId = _dcs.shift();
          if(!dcId) return;

          const accountData = await AccountController.get(accountNumber);
          const key = accountData[`dc${dcId as TrueDcId}_auth_key`];

          if(key) return g();

          // ! если одновременно запросить все нетворкеры, не будет проходить запрос на код
          setTimeout(() => {
            if(cancelled) return;
            managers.apiManager.getNetworkerVoid(dcId).finally(g);
          }, 3000);
        };

        g();
      });

      return nearestDcResult;
    }).then((nearestDcResult) => {
      if(cancelled) return;
      if(!countryInputField.value.length && !telInputField.value.length) {
        countryInputField.selectCountryByIso2(nearestDcResult.country);
      }
    });
  }

  /* ---------- lifecycle ---------- */

  let cancelFocus: (() => void) | undefined;
  onMount(() => {
    managers.appStateManager.pushToState('authState', {_: 'authStateSignIn'});

    if(!IS_TOUCH_SUPPORTED) {
      cancelFocus = focusWhenSettled(activeInput(), () => !cancelled);
    }

    tryAgain();

    fetchLoginAppConfig(managers).then((appConfig) => {
      if(cancelled || !appConfig) return;

      // TELESRV_EMAIL_SIGNUP_ENABLE: the server has no SMS, an email address is
      // how one logs in -- so that is what the card asks for
      const emailSignupEnabled = !!appConfig.email_signup_enabled;
      setEmailSignup(emailSignupEnabled);
      if(emailSignupEnabled && !isPhoneFallbackChosen()) {
        setLoginMethod(true);
      }

      // TELESRV_LOGIN_EMAIL_ENABLE: server allows email login for existing accounts
      if(appConfig.login_email_enabled) {
        setLoginEmailEnabled(true);
      }

      // TELESRV_LOGIN_EMAIL_REQUIRE_SETUP: server requires email setup before login
      // This is handled by the server returning auth.sentCodeTypeSetUpEmailRequired
      // which routes to the emailSetup cards. No client-side action needed here.
    }, () => {});
  });

  onCleanup(() => {
    cancelled = true;
    cancelFocus?.();
  });

  /* ---------- render ---------- */

  return (
    <AuthCard
      header={
        <MediaHeader>
          <MediaHeader.Sticker
            class={styles.logoContainer}
            size={120}
            element={
              <svg class={classNames(styles.logo, serverIconUrl && styles.logoCustom)} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
                <image href={serverIconUrl || 'assets/img/logo_512.png'} width="160" height="160"/>
              </svg>
            }
          />
          <MediaHeader.Title tag="h1">{i18n('Login.Title')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n(emailMode() ? 'Login.Email.StartText' : 'Login.StartText')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
      inputWrapper={false}
    >
      <div class="input-wrapper">
        {emailMode() ? emailField.container : <>
          {countryInputField.container}
          {/* one grid cell with its error line, so that the line takes no gap of the wrapper while empty */}
          <div class={styles.fieldWithError}>
            {telInputField.container}
            <AuthCardError content={floodError()} describes={telEl} />
          </div>
        </>}
        <Button
          class="btn-primary btn-color-primary"
          disabled={!hasValidInput() || submitting()}
          onClick={onSubmit}
        >
          {nextContent()}
        </Button>
        {accountNumber === 1 && <LanguageChangeButton />}
      </div>
      {emailAvailable() && (
        <Button
          class="btn-primary btn-secondary btn-primary-transparent primary"
          disabled={submitting()}
          onClick={switchLoginMethod}
        >
          {i18n(emailMode() ? 'Login.UsePhone' : 'Login.UseEmail')}
        </Button>
      )}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={submitting()}
        onClick={() => navigate({name: 'signQR'})}
        text="Login.QR.Login"
      />
      <PasskeyLoginButton disabled={submitting()} />
    </AuthCard>
  );
}
