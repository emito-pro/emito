// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.emito.io',
  base: '/',
  integrations: [
    starlight({
      title: 'Emito',
      tagline: 'Self-hosted notification engine',
      logo: { src: './src/assets/logo.svg', alt: 'Emito' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/emito-pro/emito' },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Why Emito', slug: 'why-emito' },
            { label: 'Prerequisites', slug: 'prerequisites' },
          ],
        },
        {
          label: 'Guide',
          items: [
            { label: '1. Install', slug: 'install' },
            { label: '2. Migrate', slug: 'migrate' },
            { label: '3. Configure', slug: 'configure' },
            { label: '4. Backend', slug: 'backend' },
            { label: '5. Frontend', slug: 'frontend' },
            { label: '6. Translate the UI', slug: 'i18n' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Gotchas checklist', slug: 'gotchas' },
            { label: 'Add a notification', slug: 'add-a-notification' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Subscribers & tokens', slug: 'concepts/subscribers' },
            { label: 'Channels & providers', slug: 'concepts/channels' },
            { label: 'Categories & preferences', slug: 'concepts/preferences' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Architecture', slug: 'self-hosting/architecture' },
            { label: 'Deploy to Railway', slug: 'self-hosting/railway' },
          ],
        },
        {
          label: 'AI',
          items: [
            { label: 'Overview', slug: 'ai/overview' },
            { label: 'Emito Skill', slug: 'ai/skill' },
          ],
        },
      ],
    }),
  ],
});
