<script setup lang="ts">

import { ref, reactive, nextTick, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useRoleLabel } from '@/composables/useRoleLabel'
import { notifyLoginSuccess } from '@/utils/loginNotify'
import { canRegister } from './registrationPolicy'
import { newPasswordRules } from '@/utils/passwordPolicy'
import {
  login,
  register,
  getOIDCAuthorizationURL,
  getOIDCConfig,
  autoSetup,
  getAuthConfig,
  userInfoFromApi,
  getInvitationByToken,
  registerByInvite,
  type InviteLookup,
} from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

import LoginKnowledgeField from '@/components/auth/LoginKnowledgeField.vue'
import type { KnowledgeFieldSelection, KnowledgeKind } from '@/composables/useKnowledgeField'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t, tm } = useI18n()
const { formatRole, roleIcon } = useRoleLabel()


// Form references
const formRef = ref()
const registerFormRef = ref()

// State management
const loading = ref(false)
const oidcLoading = ref(false)
const isRegisterMode = ref(false)
const oidcEnabled = ref(false)
const oidcProviderName = ref('')
// Wait for configuration before showing a registration entry.
const registrationMode = ref('')
const registrationEnabled = computed(() => canRegister(registrationMode.value, !!inviteLookup.value))
const complexPasswordEnabled = ref(false)

// invite-link state. When the URL carries ?token=xxx we resolve it to
// the originating tenant + role and switch the form into a "register
// via invitation" mode when invitation registration is enabled. Submitting the register
// form with this set hits /auth/register-by-invite (auto-login on
// success) instead of /auth/register.
const inviteToken = ref('')
const inviteLookup = ref<InviteLookup | null>(null)
const inviteLookupError = ref('')
const inviteLookupLoading = ref(false)

const oidcLoginText = computed(() => {
  if (oidcProviderName.value) {
    return t('auth.oidcLoginWithProvider', { provider: oidcProviderName.value })
  }
  return t('auth.oidcLogin')
})
const fieldPulse = ref(0)
const focusCluster = ref<KnowledgeKind | null>(null)
const fieldLabels = computed(() => ({
  rag: t('platform.rag'),
  agent: t('platform.agent'),
  wiki: t('platform.wiki'),
  hybrid: t('platform.hybridSearch'),
  doc: t('platform.carousel.smartDocRetrievalTitle'),
}))
const capabilityChips = computed(() => [
  { kind: 'rag' as const, label: t('platform.rag') },
  { kind: 'agent' as const, label: t('platform.agent') },
  { kind: 'wiki' as const, label: t('platform.wiki') },
  { kind: 'hybrid' as const, label: t('platform.hybridSearch') },
])

const pulseField = (kind?: KnowledgeKind) => {
  if (kind) focusCluster.value = kind
  fieldPulse.value += 1
}

const onFieldSelect = (selection: KnowledgeFieldSelection) => {
  focusCluster.value = selection.kind
}

watch(loading, (isLoading) => {
  if (isLoading) pulseField('agent')
})


// Login form data
const formData = reactive<{ [key: string]: any }>({
  email: '',
  password: '',
})

// Register form data
const registerData = reactive<{ [key: string]: any }>({
  username: '',
  email: '',
  password: '',
  confirmPassword: ''
})

// Login form validation rules
const formRules = computed(() => ({
  email: [
    { required: true, message: t('auth.emailRequired'), type: 'error' },
    { email: true, message: t('auth.emailInvalid'), type: 'error' }
  ],
  password: [
    { required: true, message: t('auth.passwordRequired'), type: 'error' },
    { min: 8, message: t('auth.passwordMinLength'), type: 'error' },
    { max: 32, message: t('auth.passwordMaxLength'), type: 'error' }
  ],
}))

// Register form validation rules
const registerRules = computed(() => ({
  username: [
    { required: true, message: t('auth.usernameRequired'), type: 'error' },
    { min: 2, message: t('auth.usernameMinLength'), type: 'error' },
    { max: 20, message: t('auth.usernameMaxLength'), type: 'error' },
    {
      pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/,
      message: t('auth.usernameInvalid'),
      type: 'error'
    }
  ],
  email: [
    { required: true, message: t('auth.emailRequired'), type: 'error' },
    { email: true, message: t('auth.emailInvalid'), type: 'error' }
  ],
  password: newPasswordRules(t, complexPasswordEnabled.value),
  confirmPassword: [
    { required: true, message: t('auth.confirmPasswordRequired'), type: 'error' },
    {
      validator: (val: string) => val === registerData.password,
      message: t('auth.passwordMismatch'),
      type: 'error'
    }
  ]
}))

// Toggle login/register mode
const toggleMode = () => {
  isRegisterMode.value = !isRegisterMode.value && registrationEnabled.value

  Object.keys(registerData).forEach(key => {
    (registerData as any)[key] = ''
  })
}


const persistLoginResponse = async (response: any, skipRedirect = false) => {
  // Backend renamed `tenant` to `active_tenant` and added `memberships`
  // when tenant-level RBAC landed (issue #1303). The two are otherwise
  // identical — `active_tenant` is the tenant whose ID is encoded in the
  // JWT, defaulting to the user's home tenant on a fresh login.
  const activeTenant = response.active_tenant || response.tenant
  if (response.user && response.token) {
    // user.tenant_id must be the user's HOME tenant (the immutable row
    // on the users table); useHomeTenant() and the home-badge logic both
    // assume so. The ACTIVE tenant (which can differ from home when the
    // server honoured a remembered last-active-tenant preference) is
    // expressed separately via setSelectedTenant below.
    const homeTenantIdRaw = response.user.tenant_id ?? activeTenant?.id ?? ''
    authStore.setUser(userInfoFromApi(response.user, homeTenantIdRaw))
    authStore.setToken(response.token)
    if (response.refresh_token) {
      authStore.setRefreshToken(response.refresh_token)
    }
    if (activeTenant) {
      authStore.setTenant({
        id: String(activeTenant.id) || '',
        name: activeTenant.name || '',
        owner_id: response.user.id || '',
        created_at: activeTenant.created_at || new Date().toISOString(),
        updated_at: activeTenant.updated_at || new Date().toISOString()
      })
    } else {
      authStore.setTenant(null)
    }
    if (Array.isArray(response.memberships)) {
      authStore.setMemberships(response.memberships)
    }
    // If the backend dropped us into a non-home tenant (honoured a
    // remembered "last active tenant" preference), set the override so
    // subsequent requests carry X-Tenant-ID and the UI stays consistent.
    // Otherwise clear any stale override left in localStorage by a
    // previous session for a different account.
    const activeIdNum = Number(activeTenant?.id)
    const homeIdNum = Number(homeTenantIdRaw)
    if (Number.isFinite(activeIdNum) && Number.isFinite(homeIdNum) && activeIdNum !== homeIdNum) {
      authStore.setSelectedTenant(activeIdNum, activeTenant?.name || null)
    } else {
      authStore.setSelectedTenant(null, null)
    }
  }

  // Pull runtime capabilities (including whether ordinary users may create
  // workspaces) before entering the main UI so create actions never flash
  // briefly when the deployment is invitation-only.
  await authStore.refreshFromAuthMe()
  await nextTick()
  if (skipRedirect) return
  router.replace(authStore.hasValidTenant ? '/platform/knowledge-bases' : '/onboarding/workspace')
}

const getBackendOIDCRedirectURI = () => `${window.location.origin}/api/v1/auth/oidc/callback`

const loadOIDCConfig = async () => {
  try {
    const response = await getOIDCConfig()
    oidcEnabled.value = !!response.success && !!response.enabled
    oidcProviderName.value = response.provider_display_name || ''
  } catch {
    oidcEnabled.value = false
    oidcProviderName.value = ''
  }
}

// Registration stays hidden if configuration cannot be loaded.
const loadAuthConfig = async () => {
  try {
    const response = await getAuthConfig()
    registrationMode.value = response.success ? response.registration_mode : ''
    complexPasswordEnabled.value = response.complex_password_enabled
  } catch {
    registrationMode.value = ''
    complexPasswordEnabled.value = false
  }
}

const handleOIDCLogin = async () => {
  try {
    oidcLoading.value = true
    const response = await getOIDCAuthorizationURL(getBackendOIDCRedirectURI())
    const authorizationURL = response.authorization_url

    if (!response.success || !authorizationURL) {
      MessagePlugin.error(response.message || t('auth.oidcLoginFailed'))
      return
    }

    // 跳转 IdP 会丢失 URL 中的 token，暂存到 sessionStorage，回调后由 App.vue 兑换。
    if (inviteToken.value) {
      sessionStorage.setItem('weknora_pending_invite_token', inviteToken.value)
    }
    window.location.href = authorizationURL
  } catch (error: any) {
    console.error('OIDC 登录跳转失败:', error)
    MessagePlugin.error(error.message || t('auth.oidcLoginFailed'))
  } finally {
    oidcLoading.value = false
  }
}

// 用 token 加入空间并进入应用。会话此时已有效，故即便 token 失效也照常进入（避免困在登录页）。
const acceptAndEnter = async (token: string) => {
  loading.value = true
  try {
    const result = await authStore.acceptInvitationByTokenAndRefresh(token)
    if (result.ok) {
      MessagePlugin.success(t('inviteRegister.joined'))
    } else {
      MessagePlugin.warning(t('inviteRegister.invalidBody'))
    }
  } catch {
    MessagePlugin.warning(t('inviteRegister.invalidBody'))
  } finally {
    loading.value = false
    await nextTick()
    router.replace('/platform/knowledge-bases')
  }
}

// Handle login
const handleLogin = async () => {
  try {
    const valid = await formRef.value?.validate()
    if (valid !== true) return

    loading.value = true

    const response = await login({
      email: formData.email,
      password: formData.password,
    })

    if (response.success) {
      if (inviteToken.value) {
        // 从邀请链接登录：持久化会话后兑换 token 并进入对应空间。
        await persistLoginResponse(response, true)
        await acceptAndEnter(inviteToken.value)
        return
      }
      await persistLoginResponse(response)
      notifyLoginSuccess(response, t, tm, formatRole, roleIcon)
    } else {
      MessagePlugin.error(response.message || t('auth.loginError'))
    }
  } catch (error: any) {
    console.error('登录错误:', error)
    MessagePlugin.error(error.message || t('auth.loginErrorRetry'))
  } finally {
    loading.value = false
  }
}

// Handle registration. Dispatches based on whether the user arrived
// with a share-link token: with token -> register-by-invite (auto-
// login on success); without -> the normal self-service register
// (drops back to the login form for the user to sign in).
const handleRegister = async () => {
  if (!registrationEnabled.value) return
  try {
    const valid = await registerFormRef.value?.validate()
    if (valid !== true) return

    loading.value = true

    if (inviteToken.value) {
      const response = await registerByInvite({
        token: inviteToken.value,
        username: registerData.username,
        email: registerData.email,
        password: registerData.password,
      })
      if (!response.success) {
        MessagePlugin.error(response.message || t('auth.registerFailed'))
        return
      }
      MessagePlugin.success(t('auth.registerSuccess'))
      // register-by-invite returns the same shape as login (token +
      // active_tenant + memberships), so reuse the login persistence
      // path — same store writes, same redirect target.
      await persistLoginResponse(response)
      return
    }

    const response = await register({
      username: registerData.username,
      email: registerData.email,
      password: registerData.password
    })

    if (response.success) {
      MessagePlugin.success(t('auth.registerSuccess'))

      // Switch to login mode and fill in email
      isRegisterMode.value = false
      formData.email = registerData.email

      // Clear register form
      Object.keys(registerData).forEach(key => {
        (registerData as any)[key] = ''
      })
    } else {
      MessagePlugin.error(response.message || t('auth.registerFailed'))
    }
  } catch (error: any) {
    console.error('注册错误:', error)
    MessagePlugin.error(error.message || t('auth.registerError'))
  } finally {
    loading.value = false
  }
}

// Check if already logged in; for lite edition, attempt transparent auto-setup
onMounted(async () => {
  // Share-link landing: ?token=xxx switches the form into invite-
  // register mode before any other auto-flow (logged-in redirect /
  // auto-setup / OIDC) gets a chance to redirect. Resolution failure
  // surfaces inline; the user can still log in normally if they
  // already have an account. We check this BEFORE the isLoggedIn
  // redirect so an existing session doesn't bounce the user to
  // /platform (and possibly back to /login if the session is stale),
  // dropping the invite token along the way.
  const tokenFromQuery = String(route.query.token || '').trim()
  if (tokenFromQuery) {
    inviteToken.value = tokenFromQuery
    inviteLookupLoading.value = true
    // 1. 先校验 token：无效/过期则停在登录页报错，不进注册模式。
    try {
      const resp = await getInvitationByToken(tokenFromQuery)
      if (resp.success && resp.data) {
        inviteLookup.value = resp.data
      } else {
        inviteLookupError.value = resp.message || t('inviteRegister.invalidBody')
        loadOIDCConfig()
        loadAuthConfig()
        return
      }
    } catch {
      inviteLookupError.value = t('inviteRegister.invalidBody')
      loadOIDCConfig()
      loadAuthConfig()
      return
    } finally {
      inviteLookupLoading.value = false
    }

    // 2. 已登录则直接兑换 token 进入空间（三种模式通用）。
    if (authStore.isLoggedIn && (await authStore.refreshFromAuthMe())) {
      await acceptAndEnter(tokenFromQuery)
      return
    }

    // 3. Only enabled registration modes may create an invited account.
    await loadAuthConfig()
    isRegisterMode.value = registrationEnabled.value
    loadOIDCConfig()
    return
  }

  if (authStore.isLoggedIn) {
    router.replace('/platform/knowledge-bases')
    return
  }

  localStorage.removeItem('weknora_auto_setup_failed')
  try {
    const response = await autoSetup()
    if (response.success) {
      authStore.setLiteMode(true)
      await persistLoginResponse(response)
      return
    }
  } catch {
    // Auto-setup may be unavailable outside the native Lite shell.
  }

  loadOIDCConfig()
  loadAuthConfig()
})

</script>

<template>
  <div class="login-layout">
    <LoginKnowledgeField
      :labels="fieldLabels"
      :pulse="fieldPulse"
      :focus-cluster="focusCluster"
      @select="onFieldSelect"
    />
    <div class="login-veil" />
    <div class="login-grain" />

    <div class="header-logo" title="知驱">
      <img src="@/assets/img/zhiqu.png" alt="知驱" class="logo-image" />
    </div>

    <section class="showcase-section">
      <div class="showcase-content">
        <p class="showcase-kicker">
          <span class="kicker-dot" />
          {{ $t('platform.hybridSearchEngine') }}
        </p>
        <h1 class="showcase-subtitle">{{ $t('platform.subtitle') }}</h1>
        <p class="showcase-description">{{ $t('platform.description') }}</p>

        <div class="feature-tags">
          <button
            v-for="chip in capabilityChips"
            :key="chip.kind"
            type="button"
            class="tag"
            :class="{ 'tag--active': focusCluster === chip.kind }"
            @click="pulseField(chip.kind)"
          >
            {{ chip.label }}
          </button>
        </div>

      </div>
    </section>

    <section class="form-section">
      <div class="form-panel">
        <div class="form-shell">
          <div v-if="!isRegisterMode" class="form-card">
            <div v-if="inviteLookup" class="invite-banner">
              <t-icon name="link" class="invite-banner__icon" />
              <div class="invite-banner__text">
                <div class="invite-banner__title">
                  {{ $t('inviteRegister.bannerTitle', { tenant: inviteLookup.tenant_name || '' }) }}
                </div>
                <div class="invite-banner__hint">
                  {{ $t('inviteRegister.bannerHintLogin') }}
                </div>
              </div>
            </div>
            <div v-else-if="inviteLookupError" class="invite-banner invite-banner--error">
              {{ inviteLookupError }}
            </div>

            <div class="form-header">
              <h2 class="form-title">{{ $t('auth.login') }}</h2>
              <p class="form-welcome">{{ $t('auth.subtitle') }}</p>
              <p v-if="registrationEnabled" class="form-hint">{{ $t('auth.loginHint') }}</p>
            </div>

            <div class="form-content">
              <t-form
                ref="formRef"
                :data="formData"
                :rules="formRules"
                layout="vertical"
                label-align="top"
                @submit="handleLogin"
              >
                <t-form-item :label="$t('auth.email')" name="email">
                  <t-input
                    v-model="formData.email"
                    :placeholder="$t('auth.emailPlaceholder')"
                    type="text"
                    autocomplete="email"
                    size="large"
                    :disabled="loading"
                    @focus="pulseField('hybrid')"
                  />
                </t-form-item>

                <t-form-item :label="$t('auth.password')" name="password">
                  <t-input
                    v-model="formData.password"
                    :placeholder="$t('auth.passwordPlaceholder')"
                    type="password"
                    autocomplete="current-password"
                    size="large"
                    :disabled="loading"
                    @focus="pulseField('doc')"
                    @enter="handleLogin"
                  />
                </t-form-item>

                <t-button type="submit" theme="primary" size="large" block :loading="loading" class="submit-button">
                  <span>{{ loading ? $t('auth.loggingIn') : $t('auth.login') }}</span>
                  <span class="submit-button__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                      <path d="M5 12h14" />
                      <path d="M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </t-button>

                <div v-if="registrationEnabled" class="register-cta">
                  <div class="register-cta__divider">
                    <span>{{ $t('auth.firstTime') }}</span>
                  </div>
                  <t-button
                    theme="default"
                    variant="outline"
                    size="large"
                    block
                    class="register-cta__button"
                    :disabled="loading"
                    @click="toggleMode"
                  >
                    {{ $t('auth.createAccount') }}
                  </t-button>
                </div>

                <div v-if="oidcEnabled" class="oidc-divider">
                  <span>{{ $t('auth.orContinueWith') }}</span>
                </div>

                <t-button
                  v-if="oidcEnabled"
                  theme="default"
                  size="large"
                  block
                  :loading="oidcLoading"
                  :disabled="loading"
                  class="oidc-button"
                  @click="handleOIDCLogin"
                >
                  {{ oidcLoading ? $t('auth.redirectingToOIDC') : oidcLoginText }}
                </t-button>
              </t-form>

            </div>
          </div>

          <div v-if="isRegisterMode && registrationEnabled" class="form-card">
            <div v-if="inviteLookup" class="invite-banner">
              <t-icon name="link" class="invite-banner__icon" />
              <div class="invite-banner__text">
                <div class="invite-banner__title">
                  {{ $t('inviteRegister.bannerTitle', { tenant: inviteLookup.tenant_name || '' }) }}
                </div>
                <div class="invite-banner__hint">
                  {{ $t('inviteRegister.bannerHint') }}
                </div>
              </div>
            </div>
            <div v-else-if="inviteLookupError" class="invite-banner invite-banner--error">
              {{ inviteLookupError }}
            </div>

            <div class="form-header">
              <h2 class="form-title">{{ $t('auth.createAccount') }}</h2>
              <p class="form-subtitle">{{ $t('auth.registerSubtitle') }}</p>
            </div>

            <div class="form-content">
              <t-form
                ref="registerFormRef"
                :data="registerData"
                :rules="registerRules"
                layout="vertical"
                label-align="top"
                @submit="handleRegister"
              >
                <t-form-item :label="$t('auth.username')" name="username">
                  <t-input
                    v-model="registerData.username"
                    :placeholder="$t('auth.usernamePlaceholder')"
                    size="large"
                    :disabled="loading"
                    @focus="pulseField('wiki')"
                  />
                </t-form-item>

                <t-form-item :label="$t('auth.email')" name="email">
                  <t-input
                    v-model="registerData.email"
                    :placeholder="$t('auth.emailPlaceholder')"
                    type="text"
                    autocomplete="email"
                    size="large"
                    :disabled="loading"
                    @focus="pulseField('hybrid')"
                  />
                </t-form-item>

                <t-form-item :label="$t('auth.password')" name="password">
                  <t-input
                    v-model="registerData.password"
                    :placeholder="$t('auth.passwordPlaceholder')"
                    type="password"
                    autocomplete="new-password"
                    size="large"
                    :disabled="loading"
                    @focus="pulseField('doc')"
                  />
                </t-form-item>

                <t-form-item :label="$t('auth.confirmPassword')" name="confirmPassword">
                  <t-input
                    v-model="registerData.confirmPassword"
                    :placeholder="$t('auth.confirmPasswordPlaceholder')"
                    type="password"
                    autocomplete="new-password"
                    size="large"
                    :disabled="loading"
                    @enter="handleRegister"
                  />
                </t-form-item>

                <t-button type="submit" theme="primary" size="large" block :loading="loading" class="submit-button">
                  <span>{{ loading ? $t('auth.registering') : $t('auth.register') }}</span>
                  <span class="submit-button__icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                      <path d="M5 12h14" />
                      <path d="M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </t-button>
              </t-form>

              <div class="form-footer">
                <span>{{ $t('auth.haveAccount') }}</span>
                <a href="#" class="link-button" @click.prevent="toggleMode">
                  {{ $t('auth.backToLogin') }}
                </a>
              </div>

            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

﻿<style lang="less" scoped>
.login-layout {
  --login-ink: #14352c;
  --login-muted: rgba(20, 53, 44, 0.68);
  --login-panel: rgba(255, 255, 255, 0.82);
  --login-panel-border: rgba(255, 255, 255, 0.92);
  position: relative;
  display: flex;
  width: 100%;
  min-height: 100%;
  overflow: hidden;
  color: var(--login-ink);
  background: #eef8f3;
}

.login-veil,
.login-grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.login-veil {
  background:
    linear-gradient(90deg, rgba(238, 248, 243, 0.12) 0%, rgba(238, 248, 243, 0) 46%, rgba(247, 251, 248, 0.62) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 18%, transparent 78%, rgba(228, 243, 236, 0.42));
}

.login-grain {
  opacity: 0.16;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
}

.header-logo,
.showcase-section,
.form-section {
  position: relative;
  z-index: 2;
}

.header-logo {
  position: absolute;
  top: 28px;
  left: 40px;
  z-index: 3;

  .logo-image {
    width: auto;
    height: 38px;
    display: block;
  }
}

.showcase-section {
  flex: 1.18 1 0;
  display: flex;
  align-items: flex-end;
  padding: 128px 36px 72px 72px;
}

.showcase-content {
  max-width: 620px;
}

.showcase-kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
  color: var(--login-muted);
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-family: var(--app-font-family-mono);
}

.kicker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--td-brand-color);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--td-brand-color) 18%, transparent);
  animation: kicker-pulse 2.8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}

.showcase-subtitle {
  margin: 0 0 18px;
  max-width: 8.4em;
  font-size: clamp(40px, 5.4vw, 76px);
  line-height: 1.08;
  letter-spacing: -0.05em;
  font-weight: 650;
  font-family: var(--app-font-family);
}

.showcase-description {
  margin: 0 0 28px;
  max-width: 46ch;
  font-size: 16px;
  line-height: 1.7;
  color: var(--login-muted);
}

.feature-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 28px;
}

.tag {
  border: 1px solid rgba(16, 84, 58, 0.12);
  background: rgba(255, 255, 255, 0.48);
  color: var(--login-ink);
  border-radius: 999px;
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
  font-family: var(--app-font-family);
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1), background 0.45s cubic-bezier(0.32, 0.72, 0, 1), border-color 0.45s cubic-bezier(0.32, 0.72, 0, 1);

  &:hover,
  &--active {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--td-brand-color) 12%, white);
    border-color: color-mix(in srgb, var(--td-brand-color) 42%, transparent);
  }
}

.form-section {
  flex: 0.82 1 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 96px 56px 48px 24px;
}

.form-panel,
.form-shell {
  width: min(100%, 448px);
}

.form-shell {
  padding: 8px;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.38));
  box-shadow: 0 30px 80px rgba(16, 84, 58, 0.12);
}

.form-card {
  padding: 36px 32px 28px;
  border-radius: 24px;
  background: var(--login-panel);
  border: 1px solid var(--login-panel-border);
}

.invite-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 18px;
  padding: 12px 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--td-brand-color) 10%, white);
  color: var(--login-ink);

  &--error {
    background: color-mix(in srgb, var(--td-error-color) 10%, white);
  }
}

.invite-banner__icon {
  color: var(--td-brand-color);
  margin-top: 2px;
}

.invite-banner__title {
  font-weight: 650;
  font-size: 13px;
}

.invite-banner__hint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--login-muted);
}

.form-header {
  margin-bottom: 24px;
}

.form-title {
  margin: 0 0 8px;
  font-size: 30px;
  letter-spacing: -0.04em;
  font-family: var(--app-font-family);
}

.form-welcome,
.form-subtitle {
  margin: 0;
  color: var(--login-muted);
  font-size: 14px;
  line-height: 1.6;
}

.form-hint {
  margin: 12px 0 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--td-success-color-light);
  color: var(--td-brand-color-active);
  font-size: 12.5px;
  line-height: 1.5;
}

.form-content {
  :deep(.t-form-item) {
    margin-bottom: 16px;
  }

  :deep(.t-form-item__label) {
    font-size: 13px;
    font-weight: 600;
    color: var(--login-ink);
    margin-bottom: 8px;
  }

  :deep(.t-input) {
    height: 48px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(16, 84, 58, 0.1);
    transition: border-color 0.45s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.45s cubic-bezier(0.32, 0.72, 0, 1);

    &:hover,
    &:focus-within {
      border-color: var(--td-brand-color);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--td-brand-color) 12%, transparent);
    }

    .t-input__inner,
    .t-input__wrap {
      border: none !important;
      box-shadow: none !important;
      background: transparent;
      font-size: 15px;
    }
  }
}

.submit-button {
  height: 52px;
  margin-top: 8px;
  border: 0;
  border-radius: 18px;
  font-size: 15px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--td-brand-color) 28%, transparent);
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1);

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.98);
  }

  :deep(.t-button__text) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
}

.submit-button__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1);
}

.submit-button:hover .submit-button__icon {
  transform: translateX(2px);
}

.register-cta {
  margin-top: 10px;
}

.register-cta__divider,
.oidc-divider {
  position: relative;
  text-align: center;
  margin: 16px 0 14px;
  color: var(--login-muted);
  font-size: 12px;

  span {
    position: relative;
    z-index: 1;
    padding: 0 10px;
    background: var(--login-panel);
  }

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px solid rgba(16, 84, 58, 0.1);
  }
}

.register-cta__button,
.oidc-button {
  height: 48px;
  border-radius: 16px;
  border-color: color-mix(in srgb, var(--td-brand-color) 45%, white);
  color: var(--td-brand-color-active);
}

.form-footer {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
  color: var(--login-muted);
  font-size: 13px;
}

.link-button {
  color: var(--td-brand-color-active);
  font-weight: 650;
}

@keyframes kicker-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

@media (max-width: 1024px) {
  .showcase-section {
    padding: 112px 28px 48px 40px;
  }

  .form-section {
    padding: 96px 28px 40px;
  }

  .header-logo {
    top: 26px;
    left: 28px;

    .logo-image {
      height: 34px;
    }
  }
}

@media (max-width: 768px) {
  .login-layout {
    display: flex;
    flex-direction: column;
    padding-top: 64px;
    box-sizing: border-box;
  }

  .showcase-section {
    flex: 0 0 auto;
    min-height: 42vh;
    align-items: flex-end;
    padding: 28px 24px 24px;
  }

  .showcase-subtitle {
    max-width: none;
    font-size: clamp(32px, 10vw, 48px);
  }

  .form-section {
    order: -1;
    flex: 0 0 auto;
    padding: 24px 20px 8px;
  }

  .header-logo {
    top: 18px;
    left: 20px;

    .logo-image {
      height: 30px;
    }
  }

  .form-card {
    padding: 28px 20px 22px;
  }
}

@media (max-width: 480px) {
  .showcase-section {
    min-height: 34vh;
    padding: 16px 18px 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kicker-dot,
  .tag,
  .submit-button,
  .submit-button__icon {
    animation: none !important;
    transition: none !important;
  }
}
</style>

<style lang="less">
html[theme-mode="dark"] {
  .login-layout {
    --login-ink: #e9fff6;
    --login-muted: rgba(233, 255, 246, 0.72);
    --login-panel: rgba(18, 64, 54, 0.72);
    --login-panel-border: rgba(186, 255, 226, 0.12);
    background: #1b4a40;
  }

  .login-veil {
    background:
      linear-gradient(90deg, rgba(22, 70, 60, 0.2), transparent 42%, rgba(16, 56, 48, 0.45) 100%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 30%);
  }

  .header-logo .logo-image {
    filter: invert(1) hue-rotate(180deg) brightness(1.1);
  }

  .tag,
  .form-shell,
  .form-card {
    background: rgba(16, 56, 48, 0.62);
    border-color: rgba(186, 255, 226, 0.12);
    color: var(--login-ink);
  }

  .register-cta__divider span,
  .oidc-divider span {
    background: rgba(18, 64, 54, 0.92);
  }

  .form-content .t-input {
    background: rgba(10, 42, 36, 0.55) !important;
    border-color: rgba(186, 255, 226, 0.14) !important;
  }

  .login-grain {
    mix-blend-mode: screen;
    opacity: 0.08;
  }
}
</style>
