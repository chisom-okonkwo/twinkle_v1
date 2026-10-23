-- Correct the candidate-query aliases without changing the deployed RPC signature.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.recall_service(text,uuid,jsonb)'::regprocedure) into definition;
 execute replace(definition,'publicandidate_context.','public.');
end
$migration$;
