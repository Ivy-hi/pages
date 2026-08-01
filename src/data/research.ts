export interface ResearchArea {
	id: string;
	sectionLabel: string;
	category: string;
	title: string;
	workType: string;
	status: string;
	description: string[];
	highlights: string[];
	closing?: string;
	keywords: string[];
}

export const researchProfile = {
	name: "Yi Han",
	role: "Ph.D. Candidate in Control Science and Systems Engineering",
	institution: "Peking University",
	advisor: "Prof. Wenjun Mei",
	department: "Department of Control Science and Systems Engineering",
	email: "han_yi@stu.pku.edu.cn",
	interests: [
		"Multi-Agent Systems",
		"Network Dynamics",
		"Game Theory",
		"Fairness-aware Optimization",
		"Mechanism Design",
	],
	introduction: [
		"Advised by Prof. Wenjun Mei.",
	],
	researchTheme: "Modeling and Analysis of Multi-Agent Systems",
	overview: [
		"My research focuses on mathematical modeling and analysis of multi-agent systems, with particular interests in how autonomous agents interact, learn, compete, and coordinate in complex networks. I develop theoretical frameworks combining dynamical systems, optimization, and game theory to study collective behaviors, resource allocation, fairness-efficiency trade-offs, and strategic decision-making among interacting agents.",
		"Modern systems increasingly consist of multiple autonomous decision-makers whose behaviors are coupled through social interactions, resource constraints, and strategic incentives.",
		"My research aims to understand the underlying mechanisms governing such systems through rigorous mathematical modeling and analysis.",
	],
	questions: [
		"How do individual agents influence each other's states and collective behaviors?",
		"How should limited resources be allocated among competing objectives and agents?",
		"How can appropriate mechanisms and incentives promote desirable long-term outcomes?",
	],
};

export const researchAreas: ResearchArea[] = [
	{
		id: "network-dynamics",
		sectionLabel: "A",
		category: "Multi-Agent Interaction and Network Dynamics",
		title: "Modeling and Analysis of Continuous-Time Weighted-Median Opinion Dynamics",
		workType: "Paper",
		status: "Submitted to IEEE Transactions on Automatic Control",
		description: [
			"This work studies nonlinear state evolution in social influence networks. We propose a continuous-time weighted-median interaction model, extending discrete weighted-median updating mechanisms into a nonlinear ordinary differential equation framework.",
			"The model captures compromise behavior among interacting agents, where individual states continuously evolve toward the weighted median of neighboring states.",
		],
		highlights: [
			"Existence and uniqueness of system trajectories",
			"Equilibrium structures and Lyapunov stability",
			"Global convergence from arbitrary initial conditions",
			"Graph-theoretic conditions for consensus and disagreement",
		],
		closing:
			"The analysis combines nonlinear dynamical systems, invariant set theory, and graph-based characterization.",
		keywords: [
			"Multi-agent systems",
			"Social influence networks",
			"Consensus dynamics",
			"Nonlinear dynamical systems",
			"Graph theory",
		],
	},
	{
		id: "fair-allocation",
		sectionLabel: "B",
		category: "Fairness-Aware Resource Allocation",
		title: "The Cost α-Fairness Model: A Unified Framework for Fairness in Cost Allocation",
		workType: "Paper",
		status: "Submitted to Operations Research Letters",
		description: [
			"Fairness is a fundamental consideration in resource allocation problems where efficiency and equality must be balanced. This work develops a cost-side α-fairness framework that introduces a unified parameterized objective for cost allocation.",
			"The proposed model continuously interpolates between utilitarian allocation minimizing total cost, inverse proportional fairness, and Min-Max fairness protecting the most disadvantaged agents.",
		],
		highlights: [
			"Theoretical characterization of fairness-efficiency trade-offs",
			"Interpretation of the α = 1 midpoint",
			"Price of Fairness and Price of Efficiency analysis",
			"Worst-case bounds for objective selection",
		],
		closing:
			"The framework provides a quantitative approach to understanding how different allocation principles affect collective outcomes.",
		keywords: [
			"Fair optimization",
			"Resource allocation",
			"Convex optimization",
			"Efficiency-equality trade-off",
			"Worst-case analysis",
		],
	},
	{
		id: "resource-games",
		sectionLabel: "C",
		category: "Dynamic Games and Strategic Resource Management",
		title:
			"Balancing Sustainability and Output in Renewable-Resource Differential Games via a Fairness-Competition Lever",
		workType: "Paper",
		status: "To be presented at the 23rd IFAC World Congress, Busan, Republic of Korea, 2026",
		description: [
			"This work investigates strategic resource exploitation among self-interested agents sharing renewable common-pool resources.",
			"We formulate a two-player differential game where a redistribution parameter controls the incentive structure between fairness-oriented sharing and competition-driven rewards. The study focuses on stationary feedback Nash equilibria and develops a theoretical framework based on Hamilton-Jacobi-Bellman equations, auxiliary dynamical systems, and stable manifold analysis.",
		],
		highlights: [
			"Existence and uniqueness of globally defined continuous feedback Nash equilibria",
			"Structural characterization of active and inactive regimes",
			"Comparative statics revealing the trade-off between long-term sustainability and short-term incentives",
		],
		keywords: [
			"Differential games",
			"Feedback Nash equilibrium",
			"HJB equations",
			"Dynamic optimization",
			"Sustainability",
			"Mechanism design",
		],
	},
	{
		id: "fairness-preferences",
		sectionLabel: "D",
		category: "Measuring Fairness Preferences",
		title: "How to Build a “Straight Ruler” That Measures Allocation Fairness?",
		workType: "Workshop Presentation",
		status: "IEEE CDC 2025 Workshop, Rio de Janeiro, Brazil",
		description: [
			"This work studies how fairness preferences can be quantitatively measured in allocation problems. Instead of treating fairness as a fixed principle, we introduce a γ-fairness framework that characterizes allocations according to their position on the efficiency-equality trade-off frontier.",
		],
		highlights: [
			"A parameterized fairness measurement model",
			"γ-fair frontier analysis",
			"Allocation preference identification methods",
		],
		closing:
			"We further conducted behavioral experiments using allocation scenarios to estimate individual fairness preferences and examine the stability of efficiency-equality attitudes across contexts.",
		keywords: [
			"Fairness measurement",
			"Behavioral experiments",
			"Decision theory",
			"Preference learning",
			"Optimization",
		],
	},
];
