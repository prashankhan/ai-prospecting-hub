-- Initial, fully editable project configuration. Contains no prospect records.
insert into public.projects (
  name, product_name, product_description, website, target_industry, target_countries,
  ideal_customer_profile, qualification_criteria, exclusion_criteria, preferred_channel,
  messaging_tone, ai_instructions, outreach_objective
)
select
  'Tattoo IQ',
  'Tattoo IQ',
  'Studio management software for tattoo studios: bookings, deposits, client records and artist schedules.',
  null,
  'Tattoo studios',
  array['United States', 'United Kingdom', 'Canada'],
  'Independent or multi-artist tattoo studios with an active public presence that take appointments.',
  'Active business; takes bookings or consultations; has a website or active social profile; multiple artists is a plus.',
  'Closed businesses; tattoo removal-only clinics; suppliers and schools; studios already using a competing all-in-one platform (if evident).',
  'instagram',
  'Friendly, concise, respectful. No hype. Write like a peer, not a marketer.',
  'Reference one specific, verifiable detail about the studio. Keep messages under 90 words. Never invent facts.',
  'Invite the studio owner to try Tattoo IQ with a free trial.'
where not exists (select 1 from public.projects where lower(name) = 'tattoo iq');
