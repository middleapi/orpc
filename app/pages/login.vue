<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import { authClient } from '~/utils/auth-client'

definePageMeta({
  layout: 'auth',
  middleware: 'guest'
})

useSeoMeta({
  title: 'Login',
  description: 'Login to your account to continue.'
})

const route = useRoute()
const toast = useToast()
const config = useRuntimeConfig()
const loading = ref(false)
const socialLoading = ref<'github' | 'google' | null>(null)

type SocialProvider = {
  label: string
  icon: string
  loading: boolean
  disabled: boolean
  onClick: () => Promise<void>
}

const fields = [{
  name: 'email',
  type: 'email' as const,
  label: 'Email',
  placeholder: 'Enter your email',
  required: true
}, {
  name: 'password',
  label: 'Password',
  type: 'password' as const,
  placeholder: 'Enter your password',
  required: true
}, {
  name: 'remember',
  label: 'Remember me',
  type: 'checkbox' as const
}]

const providers = computed(() => {
  const items: SocialProvider[] = []

  if (config.public.auth.githubEnabled) {
    items.push({
      label: 'Continue with GitHub',
      icon: 'i-lucide-github',
      loading: socialLoading.value === 'github',
      disabled: loading.value || Boolean(socialLoading.value),
      onClick: () => signInWithSocial('github')
    })
  }

  if (config.public.auth.googleEnabled) {
    items.push({
      label: 'Continue with Gmail',
      icon: 'i-lucide-mail',
      loading: socialLoading.value === 'google',
      disabled: loading.value || Boolean(socialLoading.value),
      onClick: () => signInWithSocial('google')
    })
  }

  return items
})

const schema = z.object({
  email: z.email('Invalid email'),
  password: z.string().min(6, 'Must be at least 6 characters'),
  remember: z.boolean().optional()
})

type Schema = z.output<typeof schema>

function getRedirectURL() {
  const redirect = route.query.redirect

  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }

  return '/apps'
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  loading.value = true

  try {
    const { error } = await authClient.signIn.email({
      email: payload.data.email,
      password: payload.data.password,
      rememberMe: payload.data.remember ?? true
    })

    if (error) {
      toast.add({
        title: 'Sign in failed',
        description: error.message ?? 'Check your email and password.',
        color: 'error'
      })
      return
    }

    await navigateTo(getRedirectURL(), { replace: true })
  } finally {
    loading.value = false
  }
}

async function signInWithSocial(provider: 'github' | 'google') {
  socialLoading.value = provider

  try {
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: getRedirectURL(),
      errorCallbackURL: '/login'
    })

    if (error) {
      toast.add({
        title: 'Social sign in failed',
        description: error.message ?? 'Could not start the sign in flow.',
        color: 'error'
      })
    }
  } finally {
    socialLoading.value = null
  }
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :providers="providers"
    :schema="schema"
    :loading="loading"
    :disabled="loading || Boolean(socialLoading)"
    title="Welcome back"
    icon="i-lucide-lock"
    @submit="onSubmit"
  >
    <template #description>
      Don't have an account?
      <ULink to="/signup" class="text-primary font-medium">Sign up</ULink>.
    </template>
  </UAuthForm>
</template>
