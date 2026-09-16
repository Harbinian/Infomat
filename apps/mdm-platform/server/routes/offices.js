const express=require('express');
const mysql=require('mysql2/promise');
const {requireAuth}=require('../auth');
const {mysqlConfigFromEnv}=require('../mysqlConfig');
const {makeOfficeRepository}=require('../officeRepository');
const router=express.Router();
let repository,repositoryFactory;
function officeRepository(){if(repositoryFactory)return repositoryFactory();if(!repository)repository=makeOfficeRepository(mysql.createPool(mysqlConfigFromEnv()));return repository;}
function run(res,action){Promise.resolve().then(action).catch(error=>{const pending=['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code);res.status(error.statusCode||(pending?503:500)).json({code:error.statusCode?error.code:pending?'OFFICE_SCHEMA_PENDING':'OFFICE_REQUEST_FAILED',error:error.statusCode?error.message:pending?'办公室管理结构尚未准备':'办公室操作暂时无法完成'});});}
router.use(requireAuth);
router.get('/workbench',(req,res)=>run(res,async()=>res.json(await officeRepository().workbench(req.session,req.query.office_id))));
router.post('/tasks',(req,res)=>run(res,async()=>res.status(201).json(await officeRepository().createTask(req.session,req.body||{}))));
router.post('/tasks/:id/receive',(req,res)=>run(res,async()=>res.json(await officeRepository().routeExistingTask(req.session,req.params.id,req.body||{}))));
router.post('/tasks/:id/assign',(req,res)=>run(res,async()=>res.json(await officeRepository().assignPerson(req.session,req.params.id,req.body||{}))));
router.post('/tasks/:id/complete',(req,res)=>run(res,async()=>res.json(await officeRepository().completeTask(req.session,req.params.id,req.body||{}))));
router.setRepositoryFactory=factory=>{repositoryFactory=factory;};
router.getOfficeRepository=officeRepository;
module.exports=router;
