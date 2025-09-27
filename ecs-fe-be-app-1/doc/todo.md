
I want to build a simple AWS deployment for two apps: a frontend (FE) and a backend (BE). Both apps have Dockerfiles.
Requirements:
	1.	Use ECS (Fargate) to run the apps.
	3.	The FE app will call the BE API.
	5.	Provide a high-level system design, including architecture diagram, AWS services used, and deployment flow.
	6.	Include simple networking options (ALB path-based routing vs internal ECS service discovery).
	7. open all network, endpoints to public
	8. use Typescript to code CDK
	9. the BE app: https://github.com/yennanliu/SpringPlayground/tree/main/ShoppingCart/Backend
	10. the FE app: https://github.com/yennanliu/SpringPlayground/tree/main/ShoppingCart/Frondend/ecommerce-ui
	11. need mysql as BE DB

