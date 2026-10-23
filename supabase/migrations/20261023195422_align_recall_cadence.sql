-- The one visible card can rotate when the chosen cadence allows a new selection.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.recall_service(text,uuid,jsonb)'::regprocedure) into definition;
 definition=replace(definition,$find$status='ready' and created_at<now()-interval '14 days'$find$,$replacement$status='ready' and created_at<now()-wait_time$replacement$);
 execute definition;
end
$migration$;
