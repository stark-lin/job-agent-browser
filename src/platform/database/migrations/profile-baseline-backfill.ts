/** V24: preserve already-applied V23 while adopting existing working profiles as initial snapshots. */
export const profileBaselineBackfillMigration = `
-- Existing saved profiles become the initial approved snapshot at upgrade.
INSERT INTO profile_baselines(profile_id,schema_version,snapshot_json,created_at)
SELECT p.id,1,json_object(
 'profile',json_object('title',p.title,'name',p.name,'email',p.email,'phone',p.phone,'location',p.location,
   'links',json(p.links_json),'introduction',p.introduction),
 'items',json((SELECT json_group_array(json(record)) FROM (
   SELECT json_object('id',id,'profileId',profile_id,'parentItemId',parent_item_id,'type',type,'title',title,
     'organization',organization,'role',role,'location',location,'startDate',start_date,'endDate',end_date,
     'summary',summary,'sortOrder',sort_order,'metadata',json(metadata_json)) record
   FROM profile_items WHERE profile_id=p.id ORDER BY sort_order,id
 ))),
 'facts',json((SELECT json_group_array(json(record)) FROM (
   SELECT json_object('id',id,'profileId',profile_id,'profileItemId',profile_item_id,'kind',kind,'content',content,
     'tags',json(tags_json),'createdAt',created_at,'updatedAt',updated_at,'sortOrder',sort_order) record
   FROM facts WHERE profile_id=p.id ORDER BY sort_order,created_at,id
 )))
),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM profile_baselines b WHERE b.profile_id=p.id);
`
