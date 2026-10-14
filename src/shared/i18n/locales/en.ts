/** Application-owned copy. Keep complete sentences so translations can reorder words. */
export const en = {
  app: {
    title: 'Job Agent Browser',
    loadingWorkspace: 'Loading workspace…'
  },
  navigation: {
    pages: {
      home: 'Home', find: 'Find Jobs', resume: 'Tailor Resume', interview: 'Interview Prep',
      applications: 'Applications', inbox: 'Inbox', profile: 'My Profile',
      browser: 'Browser', ai: 'Ask AI', settings: 'Settings'
    },
    back: 'Back', home: 'Home', forward: 'Forward',
    goHome: 'Go home', goBack: 'Go back', goForward: 'Go forward',
    pageNavigation: 'Page navigation', openSettings: 'Open Settings', workspaceNavigation: 'Workspace navigation',
    sections: { search: 'Job search', manage: 'Manage', tools: 'Tools' }
  },
  home: {
    brand: 'Job Browser',
    heading: 'What do you want to do?',
    subtitle: 'Everything you need for your job search, in one place.',
    footer: 'A focused workspace for the whole job search.',
    comingSoon: '{{label}} — Coming soon',
    cards: {
      find: 'Search and browse opportunities', resume: 'Adapt your resume to a role',
      interview: 'Prepare for a specific role', applications: 'Track applications in list or calendar view',
      inbox: 'Hiring emails and application updates', profile: 'Resume, experience and preferences',
      browser: 'Open the web freely', ai: 'Work with your job-search context',
      settings: 'AI, browser and app preferences'
    }
  },
  features: {
    comingSoon: 'Coming soon', notImplemented: 'This feature is not implemented yet.',
    descriptions: {
      find: 'Search and browse opportunities.', resume: 'Adapt your resume to a role.',
      interview: 'Prepare for a specific role.', applications: 'Track applications in list or calendar view.',
      inbox: 'Job-seeking email will open your configured webmail.',
      profile: 'Manage your resume, experience and preferences.',
      ai: 'Work with your job-search context.', settings: 'Configure AI, browser and application preferences.'
    }
  },
  browser: {
    tabs: 'Browser tabs', closeTab: 'Close tab', closeNamedTab: 'Close {{title}}', newTab: 'New tab',
    addressLabel: 'Search or enter URL', addressPlaceholder: 'Search or enter URL...',
    emptyHeading: 'Start exploring', emptyDescription: 'Search for anything or enter a web address above.'
  },
  inbox: {
    exit: 'Exit',
    configure: 'Connect your mailbox', configureHelp: 'Choose your webmail provider and address in Settings to open your mailbox here.',
    loadFailed: 'Unable to open your mailbox'
  },
  settings: {
    "aiDescription": "Configure OpenAI-compatible Chat Completions services. Keys are stored separately for each provider.",
    "newProvider": "New provider",
    "addProvider": "Add provider",
    "removeProvider": "Remove provider",
    "providerName": "Provider name",
    "baseURL": "Base URL",
    "baseURLHelp": "API root including its version path, for example https://example.com/v1. HTTPS is required except for localhost.",
    "authentication": "Authentication",
    "keyRequired": "API key required",
    "noKey": "No API key",
    "models": "Model IDs",
    "modelsHelp": "One model ID per line. Obtain IDs from your provider; model discovery is not required.",
    "defaultModel": "Default model",
    "makeDefault": "Use as global default",
    "currentDefault": "Default: {{provider}} / {{model}}",
    "noDefault": "No global default selected.",
    "removeKeyFirst": "Delete a provider’s saved key before removing its configuration. Save changes to apply removal.",
    "saveProviderFirst": "Save the provider configuration before saving its key.",
    "invalidAI": "Check the Base URL, unique non-empty model IDs and default model.",
    "testConnection": "Test connection",
    "testing": "Testing…",
    "connectionOK": "Connection and streaming response verified.",
    "testHelp": "Tests the saved provider and model with a short request, which may incur usage charges.",

    subtitle: 'Make this workspace yours. Preferences are stored on this device.',
    general: 'General', generalDescription: 'Choose the language and appearance for your workspace.',
    language: 'Language', appearance: 'Appearance', light: 'Light', dark: 'Dark', system: 'Follow system', appearanceHelp: 'Save to apply. Follow system updates when your system appearance changes.',
    ai: 'AI providers',
    provider: 'Provider', apiKey: 'API key', keyPlaceholder: 'Enter a new API key',
    keyHelp: 'Encrypted using your operating system. Saved keys are never displayed here.',
    configured: 'Key saved', notConfigured: 'No key saved',
    encryptionUnavailable: 'Secure key storage is unavailable on this device.',
    mailbox: 'Mailbox', mailboxDescription: 'Open your webmail directly from Inbox.',
    mailProvider: 'Email provider', none: 'Not configured', custom: 'Custom webmail',
    mailURL: 'Webmail URL', mailHelp: 'Use an HTTPS address without a username or password in the URL.',
    mailInvalid: 'Enter a valid HTTPS webmail URL without embedded credentials.',
    save: 'Save changes', saveKey: 'Save key', replaceKey: 'Replace key', deleteKey: 'Delete key',
    saving: 'Saving…', saved: 'Changes saved.', keySaved: 'Key saved securely.', keyDeleted: 'Key deleted.',
    deleteTitle: 'Delete the saved API key?', deleteDescription: 'You can add a new key later.', cancel: 'Cancel',
    unsaved: 'Unsaved changes', loading: 'Loading settings…', loadFailed: 'Settings could not be loaded.',
    saveFailed: 'Changes could not be saved. Your previous settings are preserved.', retry: 'Try again',
    discardTitle: 'Leave without saving?', discardDescription: 'Your unsaved settings will be discarded.',
    discard: 'Discard changes', stay: 'Keep editing',
    local: 'Stored locally', localDescription: 'Preferences and encrypted keys stay on this device. Website sign-ins are managed separately by the browser.'
  },
  audit: {
    title: 'Audit Viewer', description: 'Read local audit records, newest first. Viewing and filtering do not create records.',
    scope: 'Settings and key saves are not audited. AI success means streaming started; it does not confirm completion. Logs contain metadata only.',
    targetType: 'Target type', target: 'Target', targetId: 'Target ID', status: 'Status', all: 'All',
    from: 'From', to: 'To', localTime: 'Local time; inclusive boundary.', advanced: 'Advanced filters', exactMatch: 'Exact ID match.',
    requestId: 'Request ID', transactionId: 'Transaction ID', query: 'Search logs', reset: 'Reset', refresh: 'Refresh',
    time: 'Time', event: 'Event', action: 'Action', details: 'Audit details', viewDetails: 'View details', viewEntry: 'View audit record {{sequence}}',
    recordId: 'Record ID', sequence: 'Sequence', errorCode: 'Error code', component: 'Component', location: 'Location', source: 'Source', actor: 'Actor',
    detailDescription: 'Audit metadata. Business content, prompts, responses and keys are not stored here.', close: 'Close', noValue: 'None',
    loading: 'Loading audit records…', loadFailed: 'Audit records could not be loaded.', empty: 'No audit records yet.', noMatches: 'No records match these filters.',
    pagination: '{{total}} records · Page {{page}} of {{pages}}', previous: 'Previous page', next: 'Next page',
    invalidId: 'Enter an exact target ID (up to 120 characters) or a valid UUID for request and transaction IDs.',
    invalidTime: 'Enter a valid local date and time.', invalidRange: 'The end time must be at or after the start time.',
    statuses: { SUCCESS: 'Success', FAILURE: 'Failure' }, actions: { CREATE: 'Create', UPDATE: 'Update', DELETE: 'Delete' },
    targets: { company: 'Company', job: 'Job', job_source: 'Job source', job_event: 'Job event', profile: 'Profile', profile_item: 'Profile item', fact: 'Fact', generation_run: 'Generation run', artifact: 'Artifact', artifact_fact: 'Artifact fact', ai_request: 'AI request' }
  },
  ai: {
  "model": "Model",
  "subtitle": "Chat using your selected provider and model.",
  "newChat": "New chat",
  "selectProvider": "Select a provider",
  "configure": "Choose a configured provider and model to begin.",
  "conversation": "Conversation",
  "empty": "Start a conversation. Context is limited to the messages you send here.",
  "you": "You",
  "assistant": "AI",
  "waiting": "Waiting for a response…",
  "cancelled": "Stopped. The response may be incomplete.",
  "message": "Message",
  "memoryOnly": "Messages stay in memory while this page is open. Leaving clears the conversation.",
  "stop": "Stop",
  "retry": "Retry last message",
  "send": "Send",
  "errors": {
    "INVALID_INPUT": "The request exceeds the supported format or context limit.",
    "FORBIDDEN": "This request is not permitted.",
    "AUDIT_UNAVAILABLE": "The request could not be audited. Streaming has been stopped.",
    "ENCRYPTION_UNAVAILABLE": "Secure key storage is unavailable.",
    "STORAGE_UNAVAILABLE": "AI settings or credentials could not be read.",
    "AI_NOT_CONFIGURED": "Save a provider, model and any required key in Settings.",
    "AI_AUTH_FAILED": "The provider rejected the API key or model permissions.",
    "AI_RATE_LIMITED": "The provider rate limit was reached. Retry later.",
    "AI_PROVIDER_FAILED": "The provider could not complete this request.",
    "AI_PROTOCOL_ERROR": "The provider returned an invalid or incomplete Chat Completions stream.",
    "AI_CONNECT_FAILED": "Unable to connect to the provider.",
    "AI_TIMEOUT": "The request timed out.",
    "AI_CANCELLED": "The request was stopped."
  }
},
  errors: {
    unknownPage: 'Unknown application page.', providersUnavailable: 'Application providers are unavailable.',
    actionFailed: 'Unable to complete the action.',
    storageTitle: 'Storage unavailable',
    storageMessage: 'Local data or settings could not be opened. Your saved files have not been reset.',
    navigationInput: 'Navigation input must be text.', visibilityInput: 'Browser visibility must be a boolean.',
    presentationInput: 'Browser presentation must identify a tab and target.', tabIdInput: 'Tab ID must be text.',
    browserNotReady: 'Browser is not ready.', untrustedSender: 'Untrusted IPC sender.',
    emptyAddress: 'Enter a URL or search term.', unsupportedProtocol: 'Only HTTP and HTTPS pages can be opened.',
    invalidAddress: 'Enter a valid web address.', tabUnavailable: 'Tab is no longer available.',
    loadFailed: 'Unable to load this page. Check the address and your connection.',
    historySyncFailed: 'Unable to synchronize browser history.'
  }
} as const
